import asyncio
import hashlib
import json
import tempfile
import uuid
from pathlib import Path
from typing import Any, Coroutine, Dict, List, Optional, Set

from fastapi import BackgroundTasks, FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel

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

keyframes_cache: Dict[str, List[float]] = {}
active_jobs: Dict[str, asyncio.Queue] = {}


class ExecuteRequest(BaseModel):
    jobs: List[Dict[str, Any]]
    setting: Optional[Dict[str, Any]] = None


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
        import re

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
async def get_keyframes(path: str):
    video_path = Path(path)
    if not video_path.exists():
        raise HTTPException(status_code=404, detail='File not found')

    path_hash = hashlib.md5(str(video_path.resolve()).encode()).hexdigest()
    if path_hash in keyframes_cache:
        return {'keyframes': keyframes_cache[path_hash]}

    cmd = [
        settings.ffprobe_path,
        '-v',
        'error',
        '-skip_frame',
        'nokey',
        '-select_streams',
        'v:0',
        '-show_entries',
        'frame=pts_time,pkt_pts_time',
        '-of',
        'json',
        str(video_path),
    ]
    process = await asyncio.create_subprocess_exec(
        *cmd, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE
    )
    stdout, _ = await process.communicate()
    data = json.loads(stdout.decode())
    keyframes = [
        float(f.get('pts_time') or f.get('pkt_pts_time'))
        for f in data.get('frames', [])
        if f.get('pts_time') or f.get('pkt_pts_time')
    ]
    keyframes_cache[path_hash] = keyframes
    return {'keyframes': keyframes}


async def run_flow_background(job_id: str, request_data: Dict[str, Any]):
    queue = active_jobs[job_id]
    from datetime import timedelta

    from ffxpy.__main__ import compile_commandline

    try:
        flow = Flow.model_validate(request_data)
        resources_to_cleanup: Set[Path] = set()
        total_jobs = len(flow.jobs)
        job_ratios: Dict[int, float] = {i: 0.0 for i in range(total_jobs)}
        progress_lock = asyncio.Lock()

        job_durations: List[float] = []
        for job in flow.jobs:
            dur = 1.0
            if job.command == Command.SPLIT:
                if job.setting.input_path:
                    try:
                        info = await probe_video(
                            job.setting.input_path,
                            ffprobe_path=settings.ffprobe_path,
                        )
                        s = job.setting.start or timedelta(0)
                        e = job.setting.end or info.duration
                        dur = max(0.1, (e - s).total_seconds())
                    except Exception:
                        dur = 1.0
            elif job.command == Command.MERGE:
                try:
                    m_dur = 0.0
                    for p in job.setting.merge_paths:
                        info = await probe_video(
                            p, ffprobe_path=settings.ffprobe_path
                        )
                        m_dur += info.duration.total_seconds()
                    dur = max(1.0, m_dur)
                except Exception:
                    dur = 10.0
            job_durations.append(dur)

        async def run_single_job(index: int, job: FlowJob):
            job_name = job.name or f'Job #{index + 1}'
            weight = job_durations[index]

            before_inputs = {}
            if job.command == Command.MERGE:
                before_inputs = {'-f': 'concat', '-safe': '0'}
                if job.setting.input_path:
                    job.setting.input_path.write_text(
                        ''.join(
                            f"file '{p.resolve()}'\n" for p in job.setting.merge_paths
                        )
                    )
                    resources_to_cleanup.add(job.setting.input_path)

            if job.command == Command.SPLIT and job.setting.output_path:
                resources_to_cleanup.add(job.setting.output_path)

            # Type checking for compile_commandline
            input_p = job.setting.input_path or Path('temp.mp4')
            output_p = job.setting.output_path or Path('out.mp4')

            args = compile_commandline(
                job.setting,
                input_p,
                output_p,
                before_inputs=before_inputs,
            )

            async def progress_callback(
                data: Dict[str, Any],
            ) -> Coroutine[Any, Any, None]:
                if data['status'] == 'processing':
                    cur_p = data.get('completed', 0.0)
                    ratio = min(1.0, cur_p / weight) if weight > 0 else 1.0
                    async with progress_lock:
                        job_ratios[index] = ratio
                        overall = sum(job_ratios.values()) / total_jobs
                        data.update(
                            {
                                'overall_total': 1.0,
                                'overall_completed': overall,
                                'job_index': index,
                                'total_jobs': total_jobs,
                                'completed': ratio * 100,
                                'total': 100,
                            }
                        )
                    await queue.put(data)
                return None  # type: ignore

            await queue.put(
                {
                    'status': 'processing',
                    'job_index': index,
                    'completed': 0,
                    'total': 100,
                    'job_name': job_name,
                    'overall_total': 1.0,
                    'overall_completed': sum(job_ratios.values()) / total_jobs,
                }
            )

            success = await run_ffmpeg(
                args,
                dry_run=flow.setting.dry_run,
                total_duration=timedelta(seconds=weight),
                job_name=job_name,
                on_progress=progress_callback,  # type: ignore
            )

            if not success:
                async with progress_lock:
                    await queue.put(
                        {'status': 'failed', 'job_name': job_name, 'job_index': index}
                    )
                raise RuntimeError(f'Job {job_name} failed')

            async with progress_lock:
                job_ratios[index] = 1.0
                overall = sum(job_ratios.values()) / total_jobs
                await queue.put(
                    {
                        'status': 'job_done',
                        'job_name': job_name,
                        'job_index': index,
                        'overall_total': 1.0,
                        'overall_completed': overall,
                        'total_jobs': total_jobs,
                    }
                )

        semaphore = asyncio.Semaphore(flow.setting.concurrency)

        async def sem_run(i: int, j: FlowJob):
            async with semaphore:
                return await run_single_job(i, j)

        splits = [
            sem_run(i, j)
            for i, j in enumerate(flow.jobs)
            if j.command == Command.SPLIT
        ]
        if splits:
            await asyncio.gather(*splits)

        merges = [
            (i, j) for i, j in enumerate(flow.jobs) if j.command == Command.MERGE
        ]
        for i, j in merges:
            await run_single_job(i, j)

        if not flow.setting.keep_temp:
            for f in resources_to_cleanup:
                if f.exists():
                    try:
                        f.unlink()
                    except Exception:
                        pass

        await queue.put(
            {
                'status': 'finished',
                'overall_total': 1.0,
                'overall_completed': 1.0,
                'total_jobs': total_jobs,
            }
        )
    except Exception as e:
        await queue.put({'status': 'failed', 'error': str(e)})


@app.post('/api/execute')
async def execute_task(request: Request, background_tasks: BackgroundTasks):
    job_id = str(uuid.uuid4())
    active_jobs[job_id] = asyncio.Queue()
    data = await request.json()
    background_tasks.add_task(run_flow_background, job_id, data)
    return {'job_id': job_id}


@app.get('/api/events/{job_id}')
async def get_events(job_id: str):
    if job_id not in active_jobs:
        raise HTTPException(status_code=404, detail='Job not found')
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
