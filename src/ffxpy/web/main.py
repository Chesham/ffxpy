import asyncio
import json
import re
import tempfile
import uuid
from datetime import timedelta
from pathlib import Path
from typing import Any, Coroutine, Dict, List

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse

from ffxpy.const import Command
from ffxpy.models.flow import Flow, FlowJob
from ffxpy.probe import probe_video
from ffxpy.runner import run_ffmpeg
from ffxpy.setting import Setting

app = FastAPI(title='ffxpy Web API')
UI_DIST_DIR = Path(__file__).parent / 'ui' / 'dist'

app.add_middleware(
    CORSMiddleware,
    allow_origins=['*'],
    allow_methods=['*'],
    allow_headers=['*'],
)

settings = Setting()
TEMP_DIR = Path(tempfile.gettempdir()) / 'ffxpy_web'
TEMP_DIR.mkdir(parents=True, exist_ok=True)

# Global stores
keyframes_cache: Dict[str, List[float]] = {}
active_jobs: Dict[str, asyncio.Queue] = {}
running_tasks: Dict[str, asyncio.Task] = {}


@app.get('/api/probe')
async def get_video_info(path: str):
    video_path = Path(path)
    if not video_path.exists():
        raise HTTPException(status_code=404, detail='File not found')
    return await probe_video(video_path, ffprobe_path=settings.ffprobe_path)


@app.get('/api/stream')
async def stream_video(path: str, request: Request):
    video_path = Path(path)
    if not video_path.exists():
        raise HTTPException(status_code=404, detail='File not found')

    file_size = video_path.stat().st_size
    range_header = request.headers.get('range')

    if range_header:
        match = re.match(r'bytes=(\d+)-(\d*)', range_header)
        if match:
            start = int(match.group(1))
            end = int(match.group(2)) if match.group(2) else file_size - 1
            chunk_size = (end - start) + 1

            def file_iterator():
                with open(video_path, 'rb') as f:
                    f.seek(start)
                    remaining = chunk_size
                    while remaining > 0:
                        to_read = min(remaining, 1024 * 1024)
                        data = f.read(to_read)
                        if not data:
                            break
                        remaining -= len(data)
                        yield data

            return StreamingResponse(
                file_iterator(),
                status_code=206,
                headers={
                    'Content-Range': f'bytes {start}-{end}/{file_size}',
                    'Accept-Ranges': 'bytes',
                    'Content-Length': str(chunk_size),
                    'Content-Type': 'video/mp4',
                },
            )
    return FileResponse(video_path, media_type='video/mp4')


@app.get('/api/keyframes')
async def get_keyframes(path: str, time: float = -1.0, range_sec: float = 2.0):
    """
    Hybrid Keyframe Scanning.
    - If time < 0: Fast rough scan (Index Scan).
    - If time >= 0: Precise local scan (±range_sec).
    """
    video_path = Path(path)
    if not video_path.exists():
        raise HTTPException(status_code=404)

    import hashlib
    path_hash = hashlib.md5(str(video_path.resolve()).encode()).hexdigest()

    if time < 0:
        # Fast rough scan for the whole video
        if path_hash in keyframes_cache:
            return {'keyframes': keyframes_cache[path_hash]}
        cmd = [
            settings.ffprobe_path, '-v', 'error', '-skip_frame', 'nokey',
            '-select_streams', 'v:0', '-show_entries', 'frame=pts_time',
            '-of', 'json', str(video_path)
        ]
    else:
        # Precise local scan
        start = max(0.0, time - range_sec)
        end = time + range_sec
        cmd = [
            settings.ffprobe_path, '-v', 'error', '-select_streams', 'v:0',
            '-show_entries', 'frame=best_effort_timestamp_time,key_frame',
            '-read_intervals', f'{start}%{end}', '-of', 'json', str(video_path)
        ]

    process = await asyncio.create_subprocess_exec(
        *cmd, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE
    )
    stdout, _ = await process.communicate()
    data = json.loads(stdout.decode())

    kfs = []
    for f in data.get('frames', []):
        # In precise mode (time >= 0), only take real keyframes
        if time >= 0 and f.get('key_frame') != 1:
            continue
        t_val = f.get('best_effort_timestamp_time') or f.get('pts_time')
        if t_val is not None:
            kfs.append(float(t_val))

    sorted_kfs = sorted(list(set(kfs)))
    if time < 0:
        keyframes_cache[path_hash] = sorted_kfs
    return {'keyframes': sorted_kfs}


async def run_flow_background(job_id: str, request_data: Dict[str, Any]):
    queue = active_jobs[job_id]
    from ffxpy.__main__ import compile_commandline

    try:
        flow = Flow.model_validate(request_data)
        res_cleanup = set()
        total_jobs = len(flow.jobs)
        job_ratios: Dict[int, float] = {i: 0.0 for i in range(total_jobs)}
        progress_lock = asyncio.Lock()

        job_durations: List[float] = []
        for job in flow.jobs:
            w = 1.0
            if job.command == Command.SPLIT:
                try:
                    info = await probe_video(
                        job.setting.input_path, ffprobe_path=settings.ffprobe_path
                    )
                    s = job.setting.start or timedelta(0)
                    e = job.setting.end or info.duration
                    w = max(0.1, (e - s).total_seconds())
                except Exception:
                    w = 1.0
            elif job.command == Command.MERGE:
                try:
                    m_w = 0.0
                    for p in job.setting.merge_paths:
                        probe = await probe_video(p, settings.ffprobe_path)
                        m_w += probe.duration.total_seconds()
                    w = max(1.0, m_w)
                except Exception:
                    w = 10.0
            job_durations.append(w)

        async def run_single_job(index: int, job: FlowJob):
            job_name = job.name or f'Job #{index + 1}'
            weight = job_durations[index]
            before_inputs = {}
            if job.command == Command.MERGE:
                before_inputs = {'-f': 'concat', '-safe': '0'}
                if job.setting.input_path:
                    lines = [f"file '{p.resolve()}'\n" for p in job.setting.merge_paths]
                    job.setting.input_path.write_text(''.join(lines))
                    res_cleanup.add(job.setting.input_path)

            if job.command == Command.SPLIT and job.setting.output_path:
                res_cleanup.add(job.setting.output_path)

            input_path = job.setting.input_path or Path('temp.mp4')
            output_path = job.setting.output_path or Path('out.mp4')
            args = compile_commandline(
                job.setting, input_path, output_path, before_inputs=before_inputs
            )

            async def progress_callback(
                data: Dict[str, Any]
            ) -> Coroutine[Any, Any, None]:
                if data['status'] == 'processing':
                    cur_p = data.get('completed', 0.0)
                    ratio = min(1.0, cur_p / weight) if weight > 0 else 1.0
                    async with progress_lock:
                        job_ratios[index] = ratio
                        overall = sum(job_ratios.values()) / total_jobs
                        data.update({
                            'overall_total': 1.0,
                            'overall_completed': overall,
                            'job_index': index,
                            'total_jobs': total_jobs,
                            'completed': ratio * 100,
                            'total': 100
                        })
                    await queue.put(data)
                return None  # type: ignore

            initial_msg = {
                'status': 'processing',
                'job_index': index,
                'completed': 0,
                'total': 100,
                'job_name': job_name,
                'overall_total': 1.0,
                'overall_completed': sum(job_ratios.values()) / total_jobs
            }
            await queue.put(initial_msg)

            success = await run_ffmpeg(
                args,
                dry_run=flow.setting.dry_run,
                total_duration=timedelta(seconds=weight),
                job_name=job_name,
                on_progress=progress_callback
            )
            if not success:
                async with progress_lock:
                    await queue.put({
                        'status': 'failed', 'job_name': job_name, 'job_index': index
                    })
                raise RuntimeError(f'Job {job_name} failed')

            async with progress_lock:
                job_ratios[index] = 1.0
                overall = sum(job_ratios.values()) / total_jobs
                await queue.put({
                    'status': 'job_done',
                    'job_name': job_name,
                    'job_index': index,
                    'overall_total': 1.0,
                    'overall_completed': overall,
                    'total_jobs': total_jobs
                })

        semaphore = asyncio.Semaphore(flow.setting.concurrency)

        async def sem_run(i: int, j: FlowJob):
            async with semaphore:
                return await run_single_job(i, j)

        splits = [
            sem_run(i, j) for i, j in enumerate(flow.jobs)
            if j.command == Command.SPLIT
        ]
        if splits:
            await asyncio.gather(*splits)

        merges = [
            (i, j) for i, j in enumerate(flow.jobs)
            if j.command == Command.MERGE
        ]
        for i, j in merges:
            await run_single_job(i, j)

        await queue.put({
            'status': 'finished',
            'overall_total': 1.0,
            'overall_completed': 1.0,
            'total_jobs': total_jobs
        })
    except asyncio.CancelledError:
        await queue.put({'status': 'failed', 'error': 'Cancelled by user'})
        raise
    except Exception as e:
        await queue.put({'status': 'failed', 'error': str(e)})
    finally:
        if 'flow' in locals() and not flow.setting.keep_temp:
            for f in res_cleanup:
                if f.exists():
                    try:
                        f.unlink()
                    except Exception:
                        pass


@app.post('/api/execute')
async def execute_task(request: Request):
    job_id = str(uuid.uuid4())
    active_jobs[job_id] = asyncio.Queue()
    data = await request.json()
    task = asyncio.create_task(run_flow_background(job_id, data))
    running_tasks[job_id] = task

    def cleanup_task(t: asyncio.Task):
        if job_id in running_tasks:
            del running_tasks[job_id]
    
    task.add_done_callback(cleanup_task)
    return {'job_id': job_id}


@app.post('/api/cancel/{job_id}')
async def cancel_task(job_id: str):
    if job_id in running_tasks:
        running_tasks[job_id].cancel()
        return {'status': 'cancelling'}
    return {'status': 'not_found'}


@app.get('/api/events/{job_id}')
async def get_events(job_id: str):
    if job_id not in active_jobs:
        raise HTTPException(status_code=404)
    queue = active_jobs[job_id]

    async def event_generator():
        try:
            while True:
                try:
                    data = await asyncio.wait_for(queue.get(), timeout=30.0)
                    yield f'data: {json.dumps(data)}\n\n'
                    if data.get('status') in ['finished', 'failed']:
                        break
                except asyncio.TimeoutError:
                    yield ': ping\n\n'
        finally:
            await asyncio.sleep(2)
            if job_id in active_jobs:
                del active_jobs[job_id]
    return StreamingResponse(event_generator(), media_type='text/event-stream')


if UI_DIST_DIR.exists():
    from fastapi.staticfiles import StaticFiles
    app.mount('/', StaticFiles(directory=str(UI_DIST_DIR), html=True), name='ui')

if __name__ == '__main__':
    import uvicorn
    uvicorn.run(app, host='0.0.0.0', port=8000)
