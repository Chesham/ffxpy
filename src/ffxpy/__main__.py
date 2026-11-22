import asyncio
import os
from datetime import datetime, timedelta
from pathlib import Path

import isodate
import typer
import yaml
from rich.console import Console
from rich.progress import (
    BarColumn,
    Progress,
    TextColumn,
    TimeElapsedColumn,
    TimeRemainingColumn,
)

from ffxpy import __version__
from ffxpy.const import Command
from ffxpy.context import Context, solve_context
from ffxpy.models.flow import Flow, merge_normalize, split_normalize
from ffxpy.probe import detect_interlacing_heavily, input_format_args, is_interlaced, probe_video
from ffxpy.runner import run_ffmpeg
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
    deinterlace: bool = typer.Option(
        None,
        '--deinterlace',
        help='Auto-detect and deinterlace video if needed.',
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
    if deinterlace is not None:
        ctx.setting.deinterlace = deinterlace
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
    video_bitrate: str = typer.Option(
        None,
        help='Video bitrate.',
    ),
    audio_bitrate: str = typer.Option(
        None,
        help='Audio bitrate.',
    ),
    crop: str = typer.Option(
        None,
        help='Crop area (w:h:x:y).',
    ),
    scale: str = typer.Option(
        None,
        help='Scale (w:h).',
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
    if video_bitrate:
        setting.video_bitrate = video_bitrate
    if audio_bitrate:
        setting.audio_bitrate = audio_bitrate
    setting.with_suffix = with_suffix

    # Validate input video range
    detected_filters = []
    try:
        info = await probe_video(input_path, ffprobe_path=setting.ffprobe_path)
        if setting.start and setting.start > info.duration:
            raise ValueError(f'start time {start} is out of range ({info.duration})')
        if setting.end and setting.end > info.duration:
            raise ValueError(f'end time {end} is out of range ({info.duration})')
        if setting.start and setting.end and setting.start >= setting.end:
            raise ValueError(f'start time {start} must be less than end time {end}')

        if setting.deinterlace:
            if is_interlaced(info):
                console.print(
                    '[yellow]Interlaced video detected, applying yadif...[/yellow]'
                )
                detected_filters.append('yadif')
            else:
                # Metadata check failed, try frame analysis
                if await detect_interlacing_heavily(
                    input_path, ffmpeg_path=setting.ffmpeg_path
                ):
                    console.print(
                        '[yellow]Interlacing detected via frame analysis, '
                        'applying yadif...[/yellow]'
                    )
                    detected_filters.append('yadif')

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

    args = compile_commandline(
        setting, input_path, output_path, filters=detected_filters
    )
    success = await run_ffmpeg(
        args,
        dry_run=setting.dry_run,
        total_duration=job_duration,
        job_name=f'Splitting {input_path.name}',
        expected_output_path=output_path,
    )
    if not success and not setting.dry_run:
        raise typer.Exit(code=1)


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

    detected_filters = []
    if setting.deinterlace:
        for path in setting.merge_paths:
            try:
                info = await probe_video(path, ffprobe_path=setting.ffprobe_path)
                if is_interlaced(info):
                    console.print(
                        f'[yellow]Interlaced video detected in "{path.name}", '
                        'applying yadif...[/yellow]'
                    )
                    detected_filters.append('yadif')
                    break
                else:
                    if await detect_interlacing_heavily(
                        path, ffmpeg_path=setting.ffmpeg_path
                    ):
                        console.print(
                            f'[yellow]Interlacing detected in "{path.name}" '
                            'via frame analysis, applying yadif...[/yellow]'
                        )
                        detected_filters.append('yadif')
                        break
            except Exception:
                pass

    args = compile_commandline(
        setting,
        setting.input_path,
        setting.output_path,
        before_inputs={
            '-fflags': '+genpts',
            '-f': 'concat',
            '-safe': '0',
        },
        filters=detected_filters,
    )

    if setting.input_path:
        setting.input_path.write_text(
            ''.join(
                f"file '{path.resolve().as_posix()}'\n" for path in setting.merge_paths
            ),
            encoding='utf-8',
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
    success = await run_ffmpeg(
        args, dry_run=setting.dry_run, job_name='Merging files',
        expected_output_path=setting.output_path,
    )
    if not success and not setting.dry_run:
        raise typer.Exit(code=1)


@app.async_command(no_args_is_help=True)
async def crop(
    ctx_: typer.Context,
    input_path: Path = typer.Argument(
        help='Input video file path.',
        parser=Path,
        metavar='TEXT',
    ),
    crop: str = typer.Option(
        ...,
        help='Crop area (w:h:x:y).',
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
):
    ctx = solve_context(ctx_)
    setting = ctx.setting
    setting.crop = crop
    if video_codec:
        setting.video_codec = video_codec
    if audio_codec:
        setting.audio_codec = audio_codec
    if video_bitrate:
        setting.video_bitrate = video_bitrate
    if audio_bitrate:
        setting.audio_bitrate = audio_bitrate

    detected_filters: list[str] = []
    try:
        info = await probe_video(input_path, ffprobe_path=setting.ffprobe_path)
        # TODO: Validate crop area against info.width/height if needed
    except Exception as e:
        console.print(f'[red]Error validating input:[/red] {e}')
        raise typer.Exit(code=1)

    output_path = setting.output_path
    if not output_path:
        # Default output path for crop
        output_path = input_path.with_stem(f'{input_path.stem}_cropped')

    if setting.working_dir and not output_path.is_absolute():
        output_path = setting.working_dir / output_path.name

    output_path.parent.mkdir(parents=True, exist_ok=True)

    args = compile_commandline(
        setting, input_path, output_path, filters=detected_filters
    )
    success = await run_ffmpeg(
        args,
        dry_run=setting.dry_run,
        total_duration=info.duration,
        job_name=f'Cropping {input_path.name}',
        expected_output_path=output_path,
    )
    if not success and not setting.dry_run:
        raise typer.Exit(code=1)


@app.async_command()
async def ui(
    port: int = typer.Option(8000, help='API port'),
    host: str = typer.Option('127.0.0.1', help='API host'),
    reload: bool = typer.Option(
        False,
        '--reload',
        help='Auto-restart the backend whenever its source files change (development).',
    ),
):
    """
    Launch the Web UI for visual video editing.
    """
    import uvicorn

    console.print('[bold cyan]Starting ffxpy Web UI Backend...[/bold cyan]')
    console.print(f'API available at: [blue]http://{host}:{port}[/blue]')
    console.print(
        '[yellow]Note: For frontend live reload, run `npm run dev` in src/ffxpy/web/ui[/yellow]'
    )

    if reload:
        # uvicorn's file-watching reloader requires the app be given as an
        # import string (it re-imports it in a fresh worker process on every
        # restart) and drives its own blocking supervisor loop, so it can't
        # go through the same `uvicorn.Server().serve()` path used below.
        console.print(
            '[yellow]Reload mode: backend restarts automatically on source changes[/yellow]'
        )
        uvicorn.run(
            'ffxpy.web.main:app',
            host=host,
            port=port,
            log_level='info',
            reload=True,
            reload_dirs=[str(Path(__file__).parent)],
        )
        return

    from ffxpy.web.main import app as web_app

    config = uvicorn.Config(
        web_app, host=host, port=port, log_level='info', timeout_graceful_shutdown=2
    )
    server = uvicorn.Server(config)
    await server.serve()


@app.async_command(no_args_is_help=True)
async def flow(
    ctx_: typer.Context,
    flow_path: Path = typer.Argument(
        help='Path to ffx flow YAML file.',
        parser=Path,
        metavar='TEXT',
    ),
    skip_validation: bool = typer.Option(
        None,
        '--skip-validation',
        help='Skip pre-flight validation (e.g. ffprobe checks).',
    ),
):
    ctx = solve_context(ctx_)
    setting = ctx.setting
    if skip_validation is not None:
        setting.skip_validation = skip_validation

    flow_data = Flow.model_validate(
        yaml.safe_load(flow_path.open()), context={'setting': setting}
    )

    # Maps each job's own output back to the job that produced it, so cleanup
    # below can check *that* job's own keep_temp -- not just the flow-level
    # default -- before deleting a file another job consumes (e.g. a
    # crop/split output a later merge job reads via merge_paths).
    output_to_job = {
        job.setting.output_path: job
        for job in flow_data.jobs
        if job.setting.output_path
    }

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
    job_durations: list[timedelta | None] = []
    job_filters: list[list[str]] = []
    if not flow_data.setting.skip_validation:
        console.print('[bold cyan]Validating workflow...[/bold cyan]')
        for index, job in enumerate(flow_data.jobs):
            job_name = job.name or f'Job #{index}'
            job_duration = None
            detected_filters = []
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
                            f'end time {job.setting.end} is out of range '
                            f'({info.duration})'
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

                    if job.setting.deinterlace:
                        if is_interlaced(info):
                            console.print(
                                f'[yellow]Interlaced video detected for "{job_name}", '
                                'applying yadif...[/yellow]'
                            )
                            detected_filters.append('yadif')
                        elif await detect_interlacing_heavily(
                            job.setting.input_path, ffmpeg_path=job.setting.ffmpeg_path
                        ):
                            console.print(
                                f'[yellow]Interlacing detected for "{job_name}" '
                                'via frame analysis, applying yadif...[/yellow]'
                            )
                            detected_filters.append('yadif')

                    actual_start = job.setting.start or timedelta(0)
                    actual_end = job.setting.end or info.duration
                    job_duration = actual_end - actual_start
                except Exception as e:
                    console.print(f'[red]Validation failed for "{job_name}":[/red] {e}')
                    raise typer.Exit(code=1)
            elif job.command == Command.CROP:
                if not job.setting.input_path:
                    raise ValueError(f'job {job_name} has no input path')
                try:
                    info = await probe_video(
                        job.setting.input_path, ffprobe_path=job.setting.ffprobe_path
                    )
                    job_duration = info.duration
                    # TODO: Add crop boundary validation here if possible
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

                            # For merge, we might need deinterlace if ANY
                            # of the inputs are interlaced and we are transcoding.
                            if (
                                job.setting.deinterlace
                                and 'yadif' not in detected_filters
                            ):
                                if is_interlaced(
                                    info
                                ) or await detect_interlacing_heavily(
                                    path, ffmpeg_path=job.setting.ffmpeg_path
                                ):
                                    console.print(
                                        '[yellow]Interlaced video detected, '
                                        'applying yadif...[/yellow]'
                                    )
                                    detected_filters.append('yadif')
                        except Exception:
                            # If we can't probe one of the files, we might not have
                            # accurate total duration
                            pass
                    if total_merge_duration.total_seconds() > 0:
                        job_duration = total_merge_duration

            job_durations.append(job_duration)
            job_filters.append(detected_filters)
    else:
        console.print('[yellow]Skipping pre-flight validation...[/yellow]')
        job_durations = [None] * len(flow_data.jobs)
        job_filters = [[] for _ in range(len(flow_data.jobs))]

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

    completed_jobs = 0
    total_jobs = len(flow_data.jobs)

    def update_overall_metrics():
        metrics = f'[bold blue][{completed_jobs}/{total_jobs}][/bold blue]'
        progress.update(master_task_id, metrics=metrics)

    update_overall_metrics()

    async def run_job(job_args, job_duration, job_name, output_path):
        nonlocal completed_jobs
        async with semaphore:
            result = await run_ffmpeg(
                job_args,
                dry_run=setting.dry_run,
                total_duration=job_duration,
                job_name=job_name,
                progress=progress,
                master_task_id=master_task_id,
                expected_output_path=output_path,
            )
            completed_jobs += 1
            update_overall_metrics()
            return result

    async def cancel_pending_tasks():
        for task in pending_tasks:
            if not task.done():
                task.cancel()
        if pending_tasks:
            await asyncio.gather(*pending_tasks, return_exceptions=True)

    flow_succeeded = False
    try:
        with progress:
            for index, job in enumerate(flow_data.jobs):
                job_name = job.name or f'Job #{index}'
                job_duration = job_durations[index]
                detected_filters = job_filters[index]

                before_inputs = {}
                if job.command == Command.MERGE:
                    before_inputs = {
                        '-fflags': '+genpts',
                        '-f': 'concat',
                        '-safe': '0',
                    }
                    if job.setting.input_path:
                        job.setting.input_path.write_text(
                            ''.join(
                                f"file '{path.resolve().as_posix()}'\n"
                                for path in job.setting.merge_paths
                            ),
                            encoding='utf-8',
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
                        completed_jobs += 1
                        update_overall_metrics()
                        continue

                if not job.setting.input_path:
                    raise ValueError(f'job {job_name} has no input path')
                if not job.setting.output_path:
                    raise ValueError(f'job {job_name} has no output path')

                if not setting.dry_run:
                    job.setting.output_path.parent.mkdir(parents=True, exist_ok=True)

                args = compile_commandline(
                    job.setting,
                    job.setting.input_path,
                    job.setting.output_path,
                    before_inputs=before_inputs,
                    filters=detected_filters,
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
                        completed_jobs += 1
                        update_overall_metrics()
                        continue

                    success = await run_ffmpeg(
                        args,
                        dry_run=setting.dry_run,
                        total_duration=job_duration,
                        job_name=job_name,
                        progress=progress,
                        master_task_id=master_task_id,
                        expected_output_path=job.setting.output_path,
                    )
                    if not success and not setting.dry_run:
                        raise RuntimeError(f'Job "{job_name}" failed')
                    completed_jobs += 1
                    update_overall_metrics()
                else:
                    task = asyncio.create_task(run_job(args, job_duration, job_name, job.setting.output_path))
                    pending_tasks.append(task)

            if pending_tasks:
                results = await asyncio.gather(*pending_tasks)
                if any(r is False for r in results) and not setting.dry_run:
                    raise RuntimeError('One or more parallel jobs failed')
        flow_succeeded = True
    except (Exception, asyncio.CancelledError) as e:
        await cancel_pending_tasks()
        if not isinstance(e, asyncio.CancelledError):
            console.print(f'[red]Flow failed:[/red] {e}')
        raise typer.Exit(code=1)
    finally:

        async def _unlink_with_retry(path: Path) -> None:
            # Windows locks a file while a process still has it open --
            # right after cancelling a job, the OS may not have finished
            # releasing that handle yet even though the process has already
            # been waited on, so retry briefly instead of giving up on the
            # first failure.
            for attempt in range(3):
                try:
                    path.unlink(missing_ok=True)
                    return
                except OSError as e:
                    if attempt == 2:
                        console.print(
                            f'[yellow]Could not clean up "{path}": {e}[/yellow]'
                        )
                    else:
                        await asyncio.sleep(0.3)

        for job in flow_data.jobs if flow_succeeded else []:
            if job.command != Command.MERGE:
                continue
            # The merge job's own keep_temp decides whether its own
            # merge_list.txt survives.
            if job.setting.input_path and not job.setting.keep_temp:
                await _unlink_with_retry(job.setting.input_path)
            for path in job.setting.merge_paths:
                producer = output_to_job.get(path)
                # Only ever clean up a file this flow itself produced (found
                # in output_to_job) -- merge_paths supplied directly by the
                # user (not from an earlier job in this flow) are left
                # untouched regardless of keep_temp, since deleting a file we
                # didn't create is never this flow's call to make.
                if producer is not None and not producer.setting.keep_temp:
                    await _unlink_with_retry(path)


@app.async_command(
    context_settings={'allow_extra_args': True, 'ignore_unknown_options': True},
    no_args_is_help=True,
    help='Execute ffmpeg directly with passed arguments.',
)
async def exec(ctx_: typer.Context):
    ctx = solve_context(ctx_)
    args = [ctx.setting.ffmpeg_path, *ctx_.args]
    success = await run_ffmpeg(
        args, dry_run=ctx.setting.dry_run, job_name='Direct execution'
    )
    if not success and not ctx.setting.dry_run:
        raise typer.Exit(code=1)


def compile_commandline(
    setting: Setting,
    input_path: Path,
    output_path: Path,
    before_inputs: dict[str, str] | None = None,
    after_inputs: dict[str, str] | None = None,
    filters: list[str] | None = None,
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
            # Add a 50ms epsilon to prevent undershooting the keyframe due to float precision
            epsilon = timedelta(milliseconds=50)
            args += ['-ss', str(setting.start + epsilon)]
        elif setting.start > seek_buffer:
            # Re-encoding: hybrid seek (step 1: fast jump to 30s before target)
            args += ['-ss', str(setting.start - seek_buffer)]

    input_path_final = input_path
    if (
        setting.working_dir
        and not input_path.is_absolute()
        and not input_path.exists()
    ):
        alt_path = setting.working_dir / input_path.name
        if alt_path.exists():
            input_path_final = alt_path

    args += input_format_args(input_path_final)
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

    # Filters
    final_filters = filters[:] if filters else []
    if setting.scale:
        final_filters.append(f'scale={setting.scale}')
    if setting.crop:
        final_filters.append(f'crop={setting.crop}')
    if setting.fps and not is_copy:
        # ffmpeg's `fps` filter actually retimes by duplicating/dropping frames to
        # hit the target rate, unlike `-r` which just relabels timestamps -- needed
        # because concat-copying clips transcoded at different native frame rates
        # (e.g. one 29.97fps source mixed with 59.94fps sources) plays back with
        # stutter/lag on whichever segments don't match the container's assumed
        # rate, worst on the last (often longest) segment.
        #
        # Unlike video_bitrate/audio_bitrate (which ffmpeg silently ignores under
        # `-c:v copy`), a `-vf` filter combined with stream copy is a hard ffmpeg
        # error ("Filtering and streamcopy cannot be used together"). fps is the
        # only filter field that gets auto-filled with a real probed value (not
        # just a UI placeholder hint), so without this guard every copy-mode job
        # would fail as soon as any source's fps got auto-detected. scale/crop
        # stay ungated since those are never auto-filled -- a user who typed one
        # in alongside video_codec=copy did so on purpose, and should see
        # ffmpeg's own error rather than have it silently dropped.
        final_filters.append(f'fps={setting.fps}')

    if not is_copy and setting.start:
        # Accurate (post-input) seeking decodes from an earlier point and drops
        # leading frames/samples, but video and audio don't necessarily discard to
        # the exact same wall-clock instant (encoder lookahead/priming differs per
        # stream), so each stream's re-encoded output can start at a slightly
        # different PTS. That per-clip offset is invisible alone but compounds
        # once clips are concatenated. Reset both streams to start at PTS 0
        # independently so every clip's audio and video are aligned at frame 1.
        final_filters.append('setpts=PTS-STARTPTS')

    if final_filters:
        args += ['-vf', ','.join(final_filters)]

    audio_codec = setting.audio_codec
    if not is_copy and (setting.start or setting.end) and audio_codec == 'copy':
        # A copied audio stream can only start at its own packet boundary, but the
        # re-encoded video is cut with frame accuracy -- forcing them to diverge by
        # up to one audio frame per clip, which compounds visibly once clips are
        # concatenated. Re-encode audio too whenever we're doing an accurate cut.
        console.print(
            '[yellow]Accurate cut with re-encoded video but audio_codec=copy '
            'would desync; forcing audio re-encode (aac) for this job.[/yellow]'
        )
        audio_codec = 'aac'

    if not is_copy and setting.start and audio_codec != 'copy':
        args += ['-af', 'asetpts=PTS-STARTPTS']

    args += ['-c:v', setting.video_codec, '-c:a', audio_codec]
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

    if is_copy:
        # Prevent edit lists (which cause VFR/max frame rate bugs on merge) by zeroing start PTS
        args += ['-avoid_negative_ts', 'make_zero']

    if setting.overwrite:
        args.append('-y')
    output_path_final = output_path
    if (
        setting.working_dir
        and not output_path.is_absolute()
        and not str(output_path).startswith(str(setting.working_dir))
    ):
        output_path_final = setting.working_dir / output_path
    args.append(str(output_path_final))
    return args


if __name__ == '__main__':
    app()
