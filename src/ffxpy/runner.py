import asyncio
import re
from datetime import timedelta
from typing import Any, Callable, Dict, List, Optional

from rich.console import Console
from rich.progress import (
    BarColumn,
    Progress,
    TaskID,
    TextColumn,
    TimeElapsedColumn,
    TimeRemainingColumn,
)

console = Console()


async def run_ffmpeg(
    args: List[str],
    dry_run: bool = False,
    total_duration: Optional[timedelta] = None,
    job_name: Optional[str] = None,
    progress: Optional[Progress] = None,
    master_task_id: Optional[TaskID] = None,
    on_progress: Optional[Callable[[Dict[str, Any]], None]] = None,
):
    cmd_str = ' '.join(str(arg) for arg in args)
    if dry_run:
        console.print(f'[blue]Dry-run:[/blue] {cmd_str}')
        if on_progress:
            on_progress({'status': 'dry_run', 'cmd': cmd_str})
        return

    process = await asyncio.create_subprocess_exec(
        *[str(arg) for arg in args],
        stdin=asyncio.subprocess.DEVNULL,
        stdout=asyncio.subprocess.DEVNULL,
        stderr=asyncio.subprocess.PIPE,
    )

    internal_progress = False
    task_id = None
    if progress is not None:
        task_id = progress.add_task(
            description=job_name or 'Processing...',
            total=total_duration.total_seconds() if total_duration else None,
            metrics='',
        )
    elif not on_progress:
        # Fallback to local progress if no external reporter provided
        progress = Progress(
            TextColumn('[progress.description]{task.description}'),
            BarColumn(),
            '[progress.percentage]{task.percentage:>3.0f}%',
            TextColumn('{task.fields[metrics]}'),
            TimeElapsedColumn(),
            TimeRemainingColumn(),
            console=console,
            transient=False,
        )
        task_id = progress.add_task(
            description=job_name or 'Processing...',
            total=total_duration.total_seconds() if total_duration else None,
            metrics='',
        )
        internal_progress = True

    progress_state: Dict[str, Optional[str]] = {'fps': None, 'speed': None}
    last_completed = 0.0

    async def stream_output(stream: asyncio.StreamReader):
        nonlocal last_completed
        time_pattern = re.compile(r'time=\s*(\d+):(\d+):(\d+)(?:\.(\d+))?')
        speed_pattern = re.compile(r'speed=\s*([\d.]+x)')
        fps_pattern = re.compile(r'fps=\s*([\d.]+)')

        buffer = b''
        while True:
            chunk = await stream.read(1024)
            if not chunk:
                break

            buffer += chunk
            while True:
                r_idx = buffer.find(b'\r')
                n_idx = buffer.find(b'\n')
                if r_idx == -1 and n_idx == -1:
                    break

                split_idx = (
                    min(r_idx, n_idx)
                    if r_idx != -1 and n_idx != -1
                    else (r_idx if r_idx != -1 else n_idx)
                )
                line_bytes = buffer[:split_idx]
                buffer = buffer[split_idx + 1 :]

                line_str = line_bytes.decode('utf-8', errors='replace').strip()
                if not line_str:
                    continue

                update_kwargs: Dict[str, Any] = {}
                is_machine_format = (
                    '=' in line_str
                    and ' ' not in line_str.partition('=')[0].strip()
                    and line_str.count('=') == 1
                )

                if is_machine_format:
                    key, _, value = line_str.partition('=')
                    key, value = key.strip(), value.strip()
                    if key == 'out_time' and total_duration:
                        time_match = time_pattern.search(f'time={value}')
                        if time_match:
                            groups = time_match.groups()
                            hours, minutes, seconds = map(int, groups[:3])
                            update_kwargs['completed'] = (
                                hours * 3600 + minutes * 60 + seconds
                            )
                    elif key == 'fps':
                        try:
                            if float(value) > 0:
                                progress_state['fps'] = f'{value}fps'
                        except ValueError:
                            pass
                    elif key == 'speed':
                        if value != 'N/A':
                            progress_state['speed'] = value
                else:
                    time_match = time_pattern.search(line_str)
                    if time_match and total_duration:
                        groups = time_match.groups()
                        hours, minutes, seconds = map(int, groups[:3])
                        update_kwargs['completed'] = (
                            hours * 3600 + minutes * 60 + seconds
                        )
                    speed_match = speed_pattern.search(line_str)
                    fps_match = fps_pattern.search(line_str)
                    if fps_match:
                        progress_state['fps'] = f'{fps_match.group(1)}fps'
                    if speed_match:
                        progress_state['speed'] = speed_match.group(1)

                display_parts = [v for v in progress_state.values() if v]
                if display_parts:
                    update_kwargs['metrics'] = f'({", ".join(display_parts)})'

                if update_kwargs:
                    delta = 0.0
                    if 'completed' in update_kwargs and total_duration is not None:
                        new_completed = float(update_kwargs['completed'])
                        delta = new_completed - last_completed
                        last_completed = new_completed

                        if progress and task_id is not None:
                            progress.update(
                                task_id,
                                completed=new_completed,
                                metrics=update_kwargs.get('metrics', ''),
                            )

                        if master_task_id is not None and progress:
                            progress.advance(master_task_id, advance=delta)

                    if on_progress:
                        res = on_progress(
                            {
                                'job_name': job_name,
                                'completed': last_completed,
                                'delta': delta,
                                'total': total_duration.total_seconds()
                                if total_duration
                                else None,
                                'metrics': update_kwargs.get('metrics', ''),
                                'status': 'processing',
                            }
                        )
                        if asyncio.iscoroutine(res):
                            await res

    if process.stderr is None:
        raise RuntimeError('ffmpeg process failed to start stderr stream')

    try:
        if internal_progress and progress:
            with progress:
                await stream_output(process.stderr)
                await process.wait()
        else:
            await stream_output(process.stderr)
            await process.wait()
    except asyncio.CancelledError:
        try:
            process.terminate()
            await asyncio.wait_for(process.wait(), timeout=2.0)
        except Exception:
            try:
                process.kill()
            except Exception:
                pass
        raise

    if process.returncode != 0:
        if on_progress:
            res = on_progress({
                'status': 'error',
                'job_name': job_name,
                'returncode': process.returncode
            })
            if asyncio.iscoroutine(res):
                await res
        return False
    
    if on_progress:
        res = on_progress({'status': 'completed', 'job_name': job_name})
        if asyncio.iscoroutine(res):
            await res
    return True
