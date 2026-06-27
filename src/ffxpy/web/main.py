import asyncio
import json
import tempfile
import uuid
from datetime import timedelta
from pathlib import Path
from typing import Any, Dict, List

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from rich.console import Console

from ffxpy.const import Command
from ffxpy.models.flow import Flow, FlowJob
from ffxpy.probe import detect_interlacing_heavily, is_interlaced, probe_video
from ffxpy.runner import run_ffmpeg
from ffxpy.setting import Setting

app = FastAPI(title='ffxpy Web API')
console = Console()
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
shutdown_signal: asyncio.Event = None


@app.on_event('startup')
async def startup_event():
    global shutdown_signal
    shutdown_signal = asyncio.Event()
    import sys
    if sys.platform == 'win32':
        # Silence the annoying ConnectionResetError when scrubbing video on Windows
        try:
            from asyncio.proactor_events import _ProactorBasePipeTransport
            from functools import wraps

            original_call_connection_lost = _ProactorBasePipeTransport._call_connection_lost

            @wraps(original_call_connection_lost)
            def patched_call_connection_lost(self, exc):
                try:
                    original_call_connection_lost(self, exc)
                except ConnectionResetError:
                    pass
            _ProactorBasePipeTransport._call_connection_lost = patched_call_connection_lost
        except Exception:
            pass


@app.on_event('shutdown')
async def shutdown_event():
    """Cancel all running tasks to allow clean shutdown."""
    if shutdown_signal:
        shutdown_signal.set()
    for task_id, task in running_tasks.items():
        if not task.done():
            task.cancel()


@app.get('/api/probe')
async def get_video_info(path: str):
    video_path = Path(path)
    if not video_path.exists():
        raise HTTPException(status_code=404, detail='File not found')
    return await probe_video(video_path, ffprobe_path=settings.ffprobe_path)


from anyio import open_file

async def chunked_video(path: Path, start: int, end: int, chunk_size: int = 1024 * 1024):
    async with await open_file(path, "rb") as video:
        await video.seek(start)
        remaining = end - start + 1
        while remaining > 0:
            chunk = await video.read(min(chunk_size, remaining))
            if not chunk:
                break
            yield chunk
            remaining -= len(chunk)

@app.get('/api/stream')
async def stream_video(path: str, request: Request):
    video_path = Path(path)
    if not video_path.exists():
        raise HTTPException(status_code=404, detail='File not found')
    
    file_size = video_path.stat().st_size
    range_header = request.headers.get("Range")
    
    if not range_header:
        return FileResponse(video_path, media_type='video/mp4')
        
    try:
        range_str = range_header.replace("bytes=", "").strip()
        parts = range_str.split("-")
        start = int(parts[0])
        end = int(parts[1]) if len(parts) > 1 and parts[1] else file_size - 1
    except Exception:
        start = 0
        end = file_size - 1

    # Force a maximum chunk size (e.g. 2MB) per HTTP 206 response
    # This prevents continuous streaming of the entire file on seek
    MAX_CHUNK_SIZE = 2 * 1024 * 1024
    if end - start > MAX_CHUNK_SIZE:
        end = start + MAX_CHUNK_SIZE - 1
        
    headers = {
        "Content-Range": f"bytes {start}-{end}/{file_size}",
        "Accept-Ranges": "bytes",
        "Content-Length": str(end - start + 1),
        "Content-Type": "video/mp4",
    }
    
    return StreamingResponse(
        chunked_video(video_path, start, end),
        status_code=206,
        headers=headers,
    )


@app.post('/api/close')
async def close_video():
    """Clear all global caches to release memory and potentially file hints."""
    keyframes_cache.clear()
    return {'status': 'closed'}


@app.get('/api/dialog/open')
async def open_file_dialog():
    import tkinter as tk
    from tkinter import filedialog
    
    def _open():
        try:
            root = tk.Tk()
            root.attributes("-topmost", True)
            root.withdraw()
            file_path = filedialog.askopenfilename(
                title="Select Video File",
                filetypes=[("Video files", "*.mp4 *.mkv *.avi *.mov *.wmv *.flv *.webm *.ts *.m2ts"), ("All files", "*.*")]
            )
            root.destroy()
            return file_path
        except Exception as e:
            return None
            
    loop = asyncio.get_event_loop()
    path = await loop.run_in_executor(None, _open)
    
    if not path:
        return {"path": None}
    
    return {"path": str(Path(path).resolve().as_posix())}



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
            settings.ffprobe_path,
            '-v',
            'error',
            '-skip_frame',
            'nokey',
            '-select_streams',
            'v:0',
            '-show_entries',
            'frame=pts_time',
            '-of',
            'json',
            str(video_path),
        ]
    else:
        # Precise local scan
        start = max(0.0, time - range_sec)
        end = time + range_sec
        cmd = [
            settings.ffprobe_path,
            '-v',
            'error',
            '-select_streams',
            'v:0',
            '-show_entries',
            'frame=best_effort_timestamp_time,key_frame',
            '-read_intervals',
            f'{start}%{end}',
            '-of',
            'json',
            str(video_path),
        ]

    process = await asyncio.create_subprocess_exec(
        *cmd, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE
    )
    try:
        stdout, _ = await process.communicate()
        data = json.loads(stdout.decode())
    finally:
        if process.returncode is None:
            try:
                process.terminate()
                await process.wait()
            except Exception:
                pass

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
    from ffxpy.models.flow import merge_normalize, split_normalize

    try:
        flow = Flow.model_validate(request_data)
        console.print(
            f'[bold green]Flow Initialized:[/bold green] {len(flow.jobs)} jobs, '
            f'global deinterlace={flow.setting.deinterlace}'
        )
        res_cleanup = set()
        total_jobs = len(flow.jobs)
        job_ratios: Dict[int, float] = {i: 0.0 for i in range(total_jobs)}
        progress_lock = asyncio.Lock()

        job_durations: List[float] = []
        job_filters: List[List[str]] = []

        # Phase 0: Normalize paths
        for idx, job in enumerate(flow.jobs):
            if job.command == Command.SPLIT:
                job.setting = split_normalize(job.setting)
            elif job.command == Command.MERGE:
                job.setting = merge_normalize(
                    job.setting,
                    merge_paths=[
                        i.setting.output_path
                        for i in flow.jobs[:idx]
                        if i.setting.output_path
                    ],
                )

        # Phase 1: Pre-flight Validation
        for index, job in enumerate(flow.jobs):
            w = 1.0
            detected_filters = []
            job_name = job.name or f'Job #{index + 1}'
            if job.command == Command.SPLIT:
                if not job.setting.input_path:
                    raise ValueError(f'"{job_name}" has no input path. Please ensure global video is loaded or input_path is defined in YAML.')
                try:
                    info = await probe_video(
                        job.setting.input_path, ffprobe_path=settings.ffprobe_path
                    )
                    s = job.setting.start or timedelta(0)
                    e = job.setting.end or info.duration
                    w = max(0.1, (e - s).total_seconds())

                    if job.setting.deinterlace:
                        # Log the metadata detection result
                        fo = info.streams[0].field_order if info.streams else 'unknown'
                        if is_interlaced(info):
                            console.print(
                                f'[yellow]Interlaced detected for "{job_name}" '
                                f'(Metadata: {fo}), applying yadif...[/yellow]'
                            )
                            detected_filters.append('yadif')
                        else:
                            # Metadata says progressive/unknown, try heavy detection
                            is_interlaced_heavy = await detect_interlacing_heavily(
                                job.setting.input_path, ffmpeg_path=settings.ffmpeg_path
                            )
                            if is_interlaced_heavy:
                                console.print(
                                    f'[yellow]Interlacing detected for "{job_name}" '
                                    'via frame analysis, applying yadif...[/yellow]'
                                )
                                detected_filters.append('yadif')
                            else:
                                console.print(
                                    f'[blue]Video "{job_name}" detected as {fo}, '
                                    'frame analysis negative. '
                                    'Skipping deinterlace.[/blue]'
                                )
                except Exception as e:
                    console.print(f'[red]Validation error for "{job_name}":[/red] {e}')
                    w = 1.0
            elif job.command == Command.CROP:
                if not job.setting.input_path:
                    raise ValueError(f'"{job_name}" has no input path')
                try:
                    info = await probe_video(
                        job.setting.input_path, ffprobe_path=settings.ffprobe_path
                    )
                    w = max(0.1, info.duration.total_seconds())

                    if job.setting.deinterlace:
                        if is_interlaced(info) or await detect_interlacing_heavily(
                            job.setting.input_path, ffmpeg_path=settings.ffmpeg_path
                        ):
                            console.print(
                                f'[yellow]Interlaced detected for "{job_name}", '
                                'applying yadif...[/yellow]'
                            )
                            detected_filters.append('yadif')
                except Exception as e:
                    console.print(f'[red]Validation error for "{job_name}":[/red] {e}')
                    w = 1.0
            elif job.command == Command.MERGE:
                try:
                    m_w = 0.0
                    for p in job.setting.merge_paths:
                        if not p.exists():
                            # If file doesn't exist yet, it's likely a temporary
                            # file from previous jobs
                            continue
                        info = await probe_video(p, settings.ffprobe_path)
                        m_w += info.duration.total_seconds()
                        if job.setting.deinterlace and 'yadif' not in detected_filters:
                            if is_interlaced(info) or await detect_interlacing_heavily(
                                p, ffmpeg_path=settings.ffmpeg_path
                            ):
                                console.print(
                                    f'[yellow]Interlaced detected for "{job_name}", '
                                    'applying yadif...[/yellow]'
                                )
                                detected_filters.append('yadif')
                    w = max(1.0, m_w)
                except Exception as e:
                    console.print(f'[red]Validation error for "{job_name}":[/red] {e}')
                    w = 10.0
            job_durations.append(w)
            job_filters.append(detected_filters)

        async def run_single_job(index: int, job: FlowJob):
            job_name = job.name or f'Job #{index + 1}'
            weight = job_durations[index]
            filters = job_filters[index]
            before_inputs = {}
            if job.command == Command.MERGE:
                before_inputs = {'-f': 'concat', '-safe': '0'}
                if job.setting.input_path:
                    lines = [
                        f"file '{p.resolve().as_posix()}'\n"
                        for p in job.setting.merge_paths
                    ]
                    job.setting.input_path.write_text(''.join(lines), encoding='utf-8')
                    res_cleanup.add(job.setting.input_path)
                    for path in job.setting.merge_paths:
                        res_cleanup.add(path)

            input_path = job.setting.input_path or Path('temp.mp4')
            output_path = job.setting.output_path or Path('out.mp4')
            args = compile_commandline(
                job.setting,
                input_path,
                output_path,
                before_inputs=before_inputs,
                filters=filters,
            )

            error_log = ''

            async def progress_callback(data: Dict[str, Any]) -> None:
                nonlocal error_log
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
                elif data['status'] == 'error':
                    error_log = data.get('log', '')

            initial_msg = {
                'status': 'processing',
                'job_index': index,
                'completed': 0,
                'total': 100,
                'job_name': job_name,
                'overall_total': 1.0,
                'overall_completed': sum(job_ratios.values()) / total_jobs,
            }
            await queue.put(initial_msg)

            success = await run_ffmpeg(
                args,
                dry_run=flow.setting.dry_run,
                total_duration=timedelta(seconds=weight),
                job_name=job_name,
                on_progress=progress_callback,
            )
            if not success:
                async with progress_lock:
                    await queue.put(
                        {
                            'status': 'failed',
                            'job_name': job_name,
                            'job_index': index,
                            'error': error_log,
                        }
                    )
                raise RuntimeError(f'Job {job_name} failed. Log:\n{error_log}')

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

        encoding_jobs = [
            sem_run(i, j)
            for i, j in enumerate(flow.jobs)
            if j.command in [Command.SPLIT, Command.CROP]
        ]
        if encoding_jobs:
            await asyncio.gather(*encoding_jobs)

        merges = [(i, j) for i, j in enumerate(flow.jobs) if j.command == Command.MERGE]
        for i, j in merges:
            await run_single_job(i, j)

        await queue.put(
            {
                'status': 'finished',
                'overall_total': 1.0,
                'overall_completed': 1.0,
                'total_jobs': total_jobs,
            }
        )
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
            while not shutdown_signal.is_set():
                try:
                    # Polling the queue so we can respond to shutdown
                    try:
                        data = await asyncio.wait_for(queue.get(), timeout=2.0)
                        yield f'data: {json.dumps(data)}\n\n'
                        if data.get('status') in ['finished', 'failed']:
                            break
                    except asyncio.TimeoutError:
                        yield ': ping\n\n'
                except asyncio.CancelledError:
                    break
        finally:
            if not shutdown_signal.is_set():
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
