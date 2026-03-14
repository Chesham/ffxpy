import asyncio
import os
import re
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any

import isodate
import typer
import yaml
from rich.console import Console
from rich.progress import (
    BarColumn,
    Progress,
    TaskID,
    TextColumn,
    TimeElapsedColumn,
    TimeRemainingColumn,
)

from ffxpy import __version__
from ffxpy.const import Command
from ffxpy.context import Context, solve_context
from ffxpy.models.flow import Flow, merge_normalize, split_normalize
from ffxpy.probe import probe_video
from ffxpy.setting import Setting
from ffxpy.vendor import async_typer

app = async_typer.AsyncTyper(no_args_is_help=True)
console = Console()


def version_callback(value: bool):
    if value:
        print(f'ffxpy version {__version__}')
        raise typer.Exit()


@app.callback()
def callback(
    typer_ctx: typer.Context,
    working_dir: Path = typer.Option(
        None,
        '--working-dir',
        '-w',
        help='Working directory.',
        parser=Path,
        metavar='TEXT',
    ),
    output_path: Path = typer.Option(
        None,
        '--output-path',
        '-o',
        help='Output video file path.',
        parser=Path,
        metavar='TEXT',
    ),
    overwrite: bool = typer.Option(
        None,
        '--overwrite',
        '-y',
        help='Overwrite output file if it exists.',
    ),
    dry_run: bool = typer.Option(
        False,
        '--dry-run',
        '-n',
        help='Do not execute ffmpeg commands, only print them.',
    ),
    concurrency: int = typer.Option(
        None,
        '--concurrency',
        '-c',
        help='Number of concurrent jobs.',
    ),
    version: bool = typer.Option(
        None,
        '--version',
        '-v',
        help='Show version and exit.',
        callback=version_callback,
        is_eager=True,
    ),
):
    """
    ffxpy: A tool to simplify complex ffmpeg operations.
    """
    try:
        ctx = Context()
    except Exception as e:
        print(f'Error initializing settings: {e}')
        raise typer.Exit(code=1)

    if working_dir:
        ctx.setting.working_dir = working_dir
    if output_path:
        ctx.setting.output_path = output_path
    if overwrite is not None:
        ctx.setting.overwrite = overwrite
    if dry_run:
        ctx.setting.dry_run = dry_run
    if concurrency is not None:
        ctx.setting.concurrency = concurrency
        ctx.concurrency_specified = True
    typer_ctx.meta['context'] = ctx


def parse_duration(duration_str: str):
    try:
        return isodate.parse_duration(duration_str)
    except Exception:
        pass

    for fmt in ('%H:%M:%S.%f', '%H:%M:%S'):
        try:
            t = datetime.strptime(duration_str, fmt)
            return timedelta(
                hours=t.hour,
                minutes=t.minute,
                seconds=t.second,
                microseconds=t.microsecond,
            )
        except ValueError:
            pass

    raise ValueError(f'Invalid duration format: {duration_str}')


@app.async_command(no_args_is_help=True)
async def split(
    ctx_: typer.Context,
    input_path: Path = typer.Argument(
        help='Input video file path.',
        parser=Path,
        metavar='TEXT',
    ),
    start: timedelta = typer.Option(
        None,
        help='Start time.',
        parser=parse_duration,
        metavar='ISO 8601 DURATION',
    ),
    end: timedelta = typer.Option(
        None,
        help='End time.',
        parser=parse_duration,
        metavar='ISO 8601 DURATION',
    ),
    video_codec: str = typer.Option(
        None,
        help='Video codec.',
    ),
    audio_codec: str = typer.Option(
        None,
        help='Audio codec.',
    ),
    with_suffix: bool = typer.Option(
        True,
        '--no-suffix',
        '-S',
        help='Do not add suffix to output file name.',
    ),
):
    ctx = solve_context(ctx_)
    setting = split_normalize(ctx.setting)
    setting.start = start
    setting.end = end
    if video_codec:
        setting.video_codec = video_codec
    if audio_codec:
        setting.audio_codec = audio_codec
    setting.with_suffix = with_suffix

    # Validate input video range
    try:
        info = await probe_video(input_path, ffprobe_path=setting.ffprobe_path)
        if setting.start and setting.start > info.duration:
            raise ValueError(f'start time {start} is out of range ({info.duration})')
        if setting.end and setting.end > info.duration:
            raise ValueError(f'end time {end} is out of range ({info.duration})')
        if setting.start and setting.end and setting.start >= setting.end:
            raise ValueError(f'start time {start} must be less than end time {end}')

        # Calculate split duration for progress bar
        actual_start = setting.start or timedelta(0)
        actual_end = setting.end or info.duration
        job_duration = actual_end - actual_start
    except Exception as e:
        console.print(f'[red]Error validating input:[/red] {e}')
        raise typer.Exit(code=1)

    output_path = setting.output_path
    if not output_path:
        raise ValueError('no output path specified')

    if output_path.is_dir():
        raise ValueError('output_path cannot be a directory')

    output_path.parent.mkdir(parents=True, exist_ok=True)
    if output_path.exists():
        if setting.skip_existing:
            console.print(f'skip existing file: "{output_path}"')
            return
        if not setting.overwrite:
            raise FileExistsError(
                f'output_path "{output_path}" already exists. '
                'Use --overwrite, -y to overwrite it.'
            )

    args = compile_commandline(setting, input_path, output_path)
    await run_ffmpeg(
        args,
        dry_run=setting.dry_run,
        total_duration=job_duration,
        job_name=f'Splitting {input_path.name}',
    )


@app.async_command(no_args_is_help=True)
async def merge(
    ctx_: typer.Context,
    with_split: bool = typer.Option(
        False,
        '--with-split',
        '-s',
        help='Merge with splited files.',
    ),
    video_codec: str = typer.Option(
        None,
        help='Video codec.',
    ),
    audio_codec: str = typer.Option(
        None,
        help='Audio codec.',
    ),
    video_bitrate: str = typer.Option(
        None,
        help='Video bitrate.',
    ),
    audio_bitrate: str = typer.Option(
        None,
        help='Audio bitrate.',
    ),
    scale: str = typer.Option(
        None,
        help='Scale video.',
    ),
):
    ctx = solve_context(ctx_)
    setting = merge_normalize(ctx.setting)
    setting.with_split = with_split
    if video_codec:
        setting.video_codec = video_codec
    if audio_codec:
        setting.audio_codec = audio_codec
    if video_bitrate:
        setting.video_bitrate = video_bitrate
    if audio_bitrate:
        setting.audio_bitrate = audio_bitrate
    if scale:
        setting.scale = scale

    if not setting.merge_paths:
        raise ValueError('no merge paths found')

    args = compile_commandline(
        setting,
        setting.input_path,
        setting.output_path,
        before_inputs={
            '-f': 'concat',
            '-safe': '0',
        },
    )

    if setting.input_path:
        setting.input_path.write_text(
            ''.join(f"file '{path.resolve()}'\n" for path in setting.merge_paths)
        )

    # Smart Merge: Optimization for single file copy
    if len(setting.merge_paths) == 1:
        source_file = setting.merge_paths[0]
        source_file_final = source_file
        if (
            setting.working_dir
            and not source_file.is_absolute()
            and not source_file.exists()
        ):
            alt_path = setting.working_dir / source_file
            if alt_path.exists():
                source_file_final = alt_path

        output_path_final = setting.output_path
        if (
            setting.working_dir
            and not output_path_final.is_absolute()
            and not str(output_path_final).startswith(str(setting.working_dir))
        ):
            output_path_final = setting.working_dir / output_path_final

        can_bypass_ffmpeg = (
            setting.video_codec == 'copy'
            and setting.audio_codec == 'copy'
            and not setting.scale
        )

        if can_bypass_ffmpeg:
            if setting.dry_run:
                console.print(
                    f'[blue]Dry-run:[/blue] moving "{source_file_final}" to '
                    f'"{output_path_final}"'
                )
                return

            if output_path_final.exists():
                if not setting.overwrite:
                    raise FileExistsError(
                        f'output_path "{output_path_final}" already exists. '
                        'Use --overwrite, -y to overwrite it.'
                    )
                output_path_final.unlink()

            output_path_final.parent.mkdir(parents=True, exist_ok=True)
            import shutil

            console.print(
                f'Smart Merge: Moving single file to '
                f'[green]"{output_path_final}"[/green]'
            )
            shutil.move(source_file_final, output_path_final)
            return

    # For merge, we don't easily know the total duration without probing all parts
    # For now, let's just run it without a specific duration
    await run_ffmpeg(args, dry_run=setting.dry_run, job_name='Merging files')


@app.async_command(no_args_is_help=True)
async def flow(
    ctx_: typer.Context,
    flow_path: Path = typer.Argument(
        help='Path to ffx flow YAML file.',
        parser=Path,
        metavar='TEXT',
    ),
):
    ctx = solve_context(ctx_)
    setting = ctx.setting

    flow_data = Flow.model_validate(
        yaml.safe_load(flow_path.open()), context={'setting': setting}
    )

    # Smart Concurrency: Boost if we have many 'copy' jobs
    copy_jobs = [
        j
        for j in flow_data.jobs
        if j.setting.video_codec == 'copy' and j.setting.audio_codec == 'copy'
    ]
    is_all_copy = len(copy_jobs) == len(flow_data.jobs)

    from ffxpy.setting import get_default_concurrency

    current_default = get_default_concurrency()

    # Only auto-boost if user hasn't explicitly set a custom concurrency via CLI
    if not ctx.concurrency_specified:
        cpu_count = os.cpu_count() or 1

        if is_all_copy:
            # Pure copy mode: Max performance for I/O tasks
            turbo_concurrency = min(max(cpu_count // 4, current_default), 16)
            msg = 'All jobs are "copy", boosting to maximum I/O performance'
        else:
            # Any encoding job exists: Keep it safe
            # (current_default is already 2 for high-end)
            turbo_concurrency = min(current_default, 2)
            msg = None

        if turbo_concurrency > flow_data.setting.concurrency:
            flow_data.setting.concurrency = turbo_concurrency
            console.print(
                f'[bold yellow]Turbo Mode:[/bold yellow] {msg} ({turbo_concurrency})'
            )

    console.print(
        f'Starting flow with [green]concurrency={flow_data.setting.concurrency}[/green]'
    )

    # Phase 1: Pre-flight Validation (No side effects)
    console.print('[bold cyan]Validating workflow...[/bold cyan]')
    job_durations: list[timedelta | None] = []
    for index, job in enumerate(flow_data.jobs):
        job_name = job.name or f'Job #{index}'
        job_duration = None
        if job.command == Command.SPLIT:
            if not job.setting.input_path:
                raise ValueError(f'job {job_name} has no input path')
            try:
                info = await probe_video(
                    job.setting.input_path, ffprobe_path=job.setting.ffprobe_path
                )
                # Range validation
                if job.setting.start and job.setting.start > info.duration:
                    raise ValueError(
                        f'start time {job.setting.start} is out of range '
                        f'({info.duration})'
                    )
                if job.setting.end and job.setting.end > info.duration:
                    raise ValueError(
                        f'end time {job.setting.end} is out of range ({info.duration})'
                    )
                if (
                    job.setting.start
                    and job.setting.end
                    and job.setting.start >= job.setting.end
                ):
                    raise ValueError(
                        f'start time {job.setting.start} must be less than '
                        f'end time {job.setting.end}'
                    )

                actual_start = job.setting.start or timedelta(0)
                actual_end = job.setting.end or info.duration
                job_duration = actual_end - actual_start
            except Exception as e:
                console.print(f'[red]Validation failed for "{job_name}":[/red] {e}')
                raise typer.Exit(code=1)
        elif job.command == Command.MERGE:
            if job.setting.merge_paths:
                total_merge_duration = timedelta(0)
                for path in job.setting.merge_paths:
                    try:
                        info = await probe_video(
                            path, ffprobe_path=job.setting.ffprobe_path
                        )
                        total_merge_duration += info.duration
                    except Exception:
                        # If we can't probe one of the files, we might not have
                        # accurate total duration
                        pass
                if total_merge_duration.total_seconds() > 0:
                    job_duration = total_merge_duration

        job_durations.append(job_duration)

    # Phase 2: Execution (Start making changes)
    pending_tasks: list[asyncio.Task] = []
    semaphore = asyncio.Semaphore(flow_data.setting.concurrency)

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

    total_seconds = sum(
        (d.total_seconds() if d is not None else 1) for d in job_durations
    ) or len(flow_data.jobs)
    master_task_id = progress.add_task(
        '[bold cyan]Overall Progress[/bold cyan]', total=total_seconds, metrics=''
    )

    async def run_job(job_args, job_duration, job_name):
        async with semaphore:
            result = await run_ffmpeg(
                job_args,
                dry_run=setting.dry_run,
                total_duration=job_duration,
                job_name=job_name,
                progress=progress,
                master_task_id=master_task_id,
            )
            return result

    async def cancel_pending_tasks():
        for task in pending_tasks:
            if not task.done():
                task.cancel()
        if pending_tasks:
            await asyncio.gather(*pending_tasks, return_exceptions=True)

    try:
        with progress:
            for index, job in enumerate(flow_data.jobs):
                job_name = job.name or f'Job #{index}'
                job_duration = job_durations[index]

                before_inputs = {}
                if job.command == Command.MERGE:
                    before_inputs = {
                        '-f': 'concat',
                        '-safe': '0',
                    }
                    if job.setting.input_path:
                        job.setting.input_path.write_text(
                            ''.join(
                                f"file '{path.resolve()}'\n"
                                for path in job.setting.merge_paths
                            )
                        )

                if not job.setting.overwrite and job.setting.skip_existing:
                    if job.setting.output_path and job.setting.output_path.exists():
                        console.print(
                            f'Skip existing file: "{job.setting.output_path}"'
                        )
                        advance_amount = (
                            job_duration.total_seconds()
                            if job_duration is not None
                            else 1
                        )
                        progress.advance(master_task_id, advance=advance_amount)
                        continue

                if not job.setting.input_path:
                    raise ValueError(f'job {job_name} has no input path')
                if not job.setting.output_path:
                    raise ValueError(f'job {job_name} has no output path')

                args = compile_commandline(
                    job.setting,
                    job.setting.input_path,
                    job.setting.output_path,
                    before_inputs=before_inputs,
                )

                if job.command == Command.MERGE:
                    if pending_tasks:
                        await asyncio.gather(*pending_tasks)
                        pending_tasks.clear()

                    # Smart Merge: Optimization for single file copy
                    can_bypass_ffmpeg = (
                        len(job.setting.merge_paths) == 1
                        and job.setting.video_codec == 'copy'
                        and job.setting.audio_codec == 'copy'
                        and not job.setting.scale
                    )

                    if can_bypass_ffmpeg:
                        source_file = job.setting.merge_paths[0]
                        source_file_final = source_file
                        if (
                            setting.working_dir
                            and not source_file.is_absolute()
                            and not source_file.exists()
                        ):
                            # Only join if it doesn't exist in CWD
                            # and we have a working_dir
                            alt_path = setting.working_dir / source_file
                            if alt_path.exists():
                                source_file_final = alt_path

                        output_path_final = job.setting.output_path
                        if (
                            setting.working_dir
                            and not output_path_final.is_absolute()
                            # If the output_path already starts with working_dir,
                            # don't join
                            and not str(output_path_final).startswith(
                                str(setting.working_dir)
                            )
                        ):
                            output_path_final = setting.working_dir / output_path_final

                        console.print(
                            f'Smart Merge: Moving single file to '
                            f'[green]"{output_path_final}"[/green]'
                        )
                        if not setting.dry_run:
                            if output_path_final.exists() and not job.setting.overwrite:
                                raise FileExistsError(
                                    f'output_path "{output_path_final}" '
                                    'already exists. Use --overwrite, -y to '
                                    'overwrite it.'
                                )
                            output_path_final.parent.mkdir(parents=True, exist_ok=True)
                            import shutil

                            if output_path_final.exists():
                                output_path_final.unlink()
                            shutil.move(source_file_final, output_path_final)
                        else:
                            console.print(
                                f'[blue]Dry-run:[/blue] moving "{source_file}" '
                                f'to "{job.setting.output_path}"'
                            )

                        advance_amount = (
                            job_duration.total_seconds()
                            if job_duration is not None
                            else 1
                        )
                        progress.advance(master_task_id, advance=advance_amount)
                        continue

                    await run_ffmpeg(
                        args,
                        dry_run=setting.dry_run,
                        total_duration=job_duration,
                        job_name=job_name,
                        progress=progress,
                        master_task_id=master_task_id,
                    )
                else:
                    task = asyncio.create_task(run_job(args, job_duration, job_name))
                    pending_tasks.append(task)

            if pending_tasks:
                await asyncio.gather(*pending_tasks)
    except Exception:
        await cancel_pending_tasks()
        raise typer.Exit(code=1)

    if not flow_data.setting.keep_temp:
        for job in flow_data.jobs:
            if job.command == Command.MERGE and not job.setting.keep_temp:
                if job.setting.input_path:
                    job.setting.input_path.unlink(missing_ok=True)
                for path in job.setting.merge_paths:
                    path.unlink(missing_ok=True)


@app.async_command(
    context_settings={'allow_extra_args': True, 'ignore_unknown_options': True},
    no_args_is_help=True,
    help='Execute ffmpeg directly with passed arguments.',
)
async def exec(ctx_: typer.Context):
    ctx = solve_context(ctx_)
    args = [ctx.setting.ffmpeg_path, *ctx_.args]
    await run_ffmpeg(args, dry_run=ctx.setting.dry_run, job_name='Direct execution')


def compile_commandline(
    setting: Setting,
    input_path: Path,
    output_path: Path,
    before_inputs: dict[str, str] | None = None,
    after_inputs: dict[str, str] | None = None,
) -> list[str]:
    args = [setting.ffmpeg_path]
    # Global flags
    args += ['-hide_banner', '-stats', '-progress', 'pipe:2']

    # Custom flags before input
    if before_inputs:
        for k, v in before_inputs.items():
            if k in ['-hide_banner', '-stats', '-progress']:
                continue
            args += [str(k), str(v)]

    # Hybrid Seeking: Fast seek jump followed by Accurate seek for re-encoding.
    # Copy mode uses simple Fast Seek.
    is_copy = setting.video_codec == 'copy'
    seek_buffer = timedelta(seconds=30)

    # 1. Pre-input seeking (Fast Seek)
    if setting.start:
        if is_copy:
            # Copy mode: simple fast seek before -i
            args += ['-ss', str(setting.start)]
        elif setting.start > seek_buffer:
            # Re-encoding: hybrid seek (step 1: fast jump to 30s before target)
            args += ['-ss', str(setting.start - seek_buffer)]

    input_path_final = input_path
    if setting.working_dir and not input_path.is_absolute():
        input_path_final = setting.working_dir / input_path.name

    args += ['-i', str(input_path_final)]

    # 2. Post-input seeking (Accurate Seek)
    if not is_copy and setting.start:
        if setting.start > seek_buffer:
            # Re-encoding: hybrid seek (step 2: accurate finish)
            args += ['-ss', str(seek_buffer)]
        else:
            # Re-encoding: simple accurate seek for short offsets
            args += ['-ss', str(setting.start)]

    # 3. Duration handling (always use -t after -i for robustness)
    if setting.end:
        start_time = setting.start or timedelta(0)
        duration = setting.end - start_time
        if duration.total_seconds() > 0:
            args += ['-t', str(duration)]

    if after_inputs:
        args += [str(item) for pair in after_inputs.items() for item in pair]

    if setting.scale:
        args += ['-vf', f'scale={setting.scale}']
    args += ['-c:v', setting.video_codec, '-c:a', setting.audio_codec]
    if setting.video_bitrate:
        args += ['-b:v', setting.video_bitrate]
    if setting.audio_bitrate:
        args += ['-b:a', setting.audio_bitrate]
    if setting.maxrate:
        args += ['-maxrate', setting.maxrate]
    if setting.bufsize:
        args += ['-bufsize', setting.bufsize]
    if setting.preset:
        args += ['-preset', setting.preset]
    args += ['-rc', setting.rc]
    if setting.overwrite:
        args.append('-y')
    output_path_final = output_path
    if setting.working_dir and not output_path.is_absolute():
        output_path_final = setting.working_dir / output_path.name
    args.append(str(output_path_final))
    return args


async def run_ffmpeg(
    args: list[str],
    dry_run: bool = False,
    total_duration: timedelta | None = None,
    job_name: str | None = None,
    progress: Progress | None = None,
    master_task_id: TaskID | None = None,
):
    cmd_str = ' '.join(str(arg) for arg in args)
    if dry_run:
        console.print(f'[blue]Dry-run:[/blue] {cmd_str}')
        return

    process = await asyncio.create_subprocess_exec(
        *[str(arg) for arg in args],
        stdin=asyncio.subprocess.DEVNULL,
        stdout=asyncio.subprocess.DEVNULL,
        stderr=asyncio.subprocess.PIPE,
    )

    internal_progress = False
    if progress is None:
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

        internal_progress = True

    task_id = progress.add_task(
        description=job_name or 'Processing...',
        total=None,
        metrics='',
    )

    # Shared state for progress metrics to prevent overwriting
    progress_state: dict[str, str | None] = {'fps': None, 'speed': None}
    last_completed = 0.0

    async def stream_output(stream: asyncio.StreamReader):
        nonlocal last_completed
        # ffmpeg outputs progress to stderr
        # Robust pattern for time: allows optional leading spaces and
        # optional fractional part
        time_pattern = re.compile(r'time=\s*(\d+):(\d+):(\d+)(?:\.(\d+))?')
        speed_pattern = re.compile(r'speed=\s*([\d.]+x)')
        fps_pattern = re.compile(r'fps=\s*([\d.]+)')

        buffer = b''
        while True:
            # Read chunks instead of lines to catch \r
            chunk = await stream.read(1024)
            if not chunk:
                break

            buffer += chunk
            # Robust line splitting
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

                # Update progress and metrics
                update_kwargs: dict[str, Any] = {}

                # Distinguish between machine-readable progress (-progress pipe:2)
                # and legacy status line
                # Machine-readable lines have exactly one '=' and no internal
                # spaces in the key.
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
                            f_val = float(value)
                            if f_val > 0:
                                progress_state['fps'] = f'{value}fps'
                        except ValueError:
                            pass
                    elif key == 'speed':
                        if value != 'N/A':
                            progress_state['speed'] = value
                else:
                    # Legacy status line parsing (can have multiple '=' or spaces)
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

                # Always build metrics string from persistent state
                display_parts = [v for v in progress_state.values() if v]
                if display_parts:
                    update_kwargs['metrics'] = f'({", ".join(display_parts)})'

                if update_kwargs:
                    if 'completed' in update_kwargs and total_duration is not None:
                        new_completed = float(update_kwargs['completed'])
                        delta = new_completed - last_completed
                        last_completed = new_completed

                        update_kwargs['total'] = total_duration.total_seconds()
                        if master_task_id is not None:
                            progress.advance(master_task_id, advance=delta)

                    progress.update(task_id, **update_kwargs)

    if not process.stderr:
        raise RuntimeError('ffmpeg process failed to start stderr stream')

    if internal_progress:
        with progress:
            await asyncio.gather(
                stream_output(process.stderr),
                process.wait(),
            )
    else:
        await asyncio.gather(
            stream_output(process.stderr),
            process.wait(),
        )

    # Force completion to 100% regardless of ffmpeg output timing
    if total_duration:
        new_completed = total_duration.total_seconds()
        delta = new_completed - last_completed
        progress.update(task_id, completed=new_completed)
        if master_task_id is not None:
            progress.advance(master_task_id, advance=delta)
    else:
        # For tasks without known duration (like merge), mark as finished
        progress.update(task_id, total=100, completed=100)
        if master_task_id is not None:
            progress.advance(master_task_id, advance=1)

    if process.returncode != 0:
        console.print(f'[red]Error:[/red] ffmpeg exited with code {process.returncode}')
        raise typer.Exit(code=process.returncode or 1)

    return process


if __name__ == '__main__':
    app()
