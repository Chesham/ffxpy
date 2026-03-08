import asyncio
import re
from datetime import datetime, timedelta
from pathlib import Path

import isodate
import typer
import yaml
from rich.console import Console
from rich.progress import BarColumn, Progress, TextColumn, TimeRemainingColumn

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
        info = probe_video(input_path, ffprobe_path=setting.ffprobe_path)
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
        job_name=f'Splitting {input_path.name}'
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
):
    ctx = solve_context(ctx_)
    setting = merge_normalize(ctx.setting)
    setting.with_split = with_split

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

    # For merge, we don't easily know the total duration without probing all parts
    # For now, let's just run it without a specific duration
    await run_ffmpeg(
        args, 
        dry_run=setting.dry_run, 
        job_name='Merging files'
    )


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

    pending_tasks = []
    for index, job in enumerate(flow_data.jobs):
        job_name = job.name or f'Job #{index}'
        
        before_inputs = {}
        if job.command == Command.MERGE:
            before_inputs = {
                '-f': 'concat',
                '-safe': '0',
            }
            job.setting.input_path.write_text(
                ''.join(
                    f"file '{path.resolve()}'\n" for path in job.setting.merge_paths
                )
            )

        if not job.setting.overwrite and job.setting.skip_existing:
            if job.setting.output_path and job.setting.output_path.exists():
                console.print(f'Skip existing file: "{job.setting.output_path}"')
                continue

        args = compile_commandline(
            job.setting,
            job.setting.input_path,
            job.setting.output_path,
            before_inputs=before_inputs,
        )

        # Get duration if it's a split job
        job_duration = None
        if job.command == Command.SPLIT:
            try:
                info = probe_video(job.setting.input_path, ffprobe_path=job.setting.ffprobe_path)
                actual_start = job.setting.start or timedelta(0)
                actual_end = job.setting.end or info.duration
                job_duration = actual_end - actual_start
            except Exception:
                pass

        if job.command == Command.MERGE:
            if pending_tasks:
                await asyncio.gather(*pending_tasks)
                pending_tasks.clear()
            await run_ffmpeg(
                args, 
                dry_run=setting.dry_run, 
                job_name=job_name
            )
        else:
            task = asyncio.create_task(
                run_ffmpeg(
                    args, 
                    dry_run=setting.dry_run, 
                    total_duration=job_duration, 
                    job_name=job_name
                )
            )
            pending_tasks.append(task)

    if pending_tasks:
        await asyncio.gather(*pending_tasks)

    if not flow_data.setting.keep_temp:
        for job in flow_data.jobs:
            if job.command == Command.MERGE and not job.setting.keep_temp:
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
    before_inputs: dict = None,
    after_inputs: dict = None,
) -> list[str]:
    args = [setting.ffmpeg_path]
    if before_inputs:
        args += [str(item) for pair in before_inputs.items() for item in pair]
    input_path_final = input_path
    if setting.working_dir and not input_path.is_absolute():
        input_path_final = setting.working_dir / input_path.name
    if setting.video_codec == 'copy':
        if setting.start:
            args += ['-ss', str(setting.start)]
        if setting.end:
            args += ['-to', str(setting.end)]
    args += ['-i', input_path_final]
    if after_inputs:
        args += [str(item) for pair in after_inputs.items() for item in pair]
    if setting.start and '-ss' not in args:
        args += ['-ss', str(setting.start)]
    if setting.end and '-to' not in args:
        args += ['-to', str(setting.end)]
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
    args.append(output_path_final)
    return args


async def run_ffmpeg(
    args,
    dry_run: bool = False,
    total_duration: timedelta | None = None,
    job_name: str | None = None,
):
    cmd_str = ' '.join(str(arg) for arg in args)
    if dry_run:
        console.print(f'[blue]Dry-run:[/blue] {cmd_str}')
        return

    process = await asyncio.create_subprocess_exec(
        *[str(arg) for arg in args],
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )

    progress = Progress(
        TextColumn('[progress.description]{task.description}'),
        BarColumn(),
        '[progress.percentage]{task.percentage:>3.0f}%',
        TimeRemainingColumn(),
        console=console,
        transient=True,
    )

    task_id = progress.add_task(
        description=job_name or 'Processing...',
        total=total_duration.total_seconds() if total_duration else None,
    )

    async def stream_output(stream, is_stderr=False):
        # ffmpeg outputs progress to stderr
        time_pattern = re.compile(r'time=(\d+):(\d+):(\d+)\.(\d+)')
        while True:
            line = await stream.readline()
            if not line:
                break

            line_str = line.decode('utf-8', errors='replace').strip()
            if is_stderr and total_duration:
                match = time_pattern.search(line_str)
                if match:
                    hours, minutes, seconds, _ = map(int, match.groups())
                    current_seconds = hours * 3600 + minutes * 60 + seconds
                    progress.update(task_id, completed=current_seconds)

    with progress:
        await asyncio.gather(
            stream_output(process.stdout),
            stream_output(process.stderr, is_stderr=True),
            process.wait(),
        )

    if process.returncode != 0:
        console.print(f'[red]Error:[/red] ffmpeg exited with code {process.returncode}')
        raise typer.Exit(code=process.returncode)

    return process


if __name__ == '__main__':
    app()
