import asyncio
from datetime import datetime, timedelta
from pathlib import Path

import isodate
import typer
import yaml

from ffxpy.const import Command
from ffxpy.context import Context, solve_context
from ffxpy.models.flow import Flow, merge_normalize, split_normalize
from ffxpy.setting import Setting
from ffxpy.vendor import async_typer

app = async_typer.AsyncTyper(no_args_is_help=True)


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
):
    '''
    ffxpy: A tool to simplify complex ffmpeg operations.
    '''
    ctx = Context()
    if working_dir:
        ctx.setting.working_dir = working_dir
    if output_path:
        ctx.setting.output_path = output_path
    if overwrite is not None:
        ctx.setting.overwrite = overwrite
    typer_ctx.meta['context'] = ctx


def parse_duration(duration_str: str):
    try:
        return isodate.parse_duration(duration_str)
    except Exception:
        pass

    t = datetime.strptime(duration_str, '%H:%M:%S.%f')
    return timedelta(
        hours=t.hour, minutes=t.minute, seconds=t.second, microseconds=t.microsecond
    )


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
        help='Video codec to use.',
        metavar='CODEC',
    ),
    audio_codec: str = typer.Option(
        None,
        help='Audio codec to use.',
        metavar='CODEC',
    ),
    with_suffix: bool = typer.Option(
        True,
        '--no-suffix',
        '-S',
        help='Do not add suffix to output file name.',
    ),
):
    ctx = solve_context(ctx_)
    ctx.setting.input_path = input_path
    setting = split_normalize(ctx.setting)
    setting.start = start
    setting.end = end
    if video_codec:
        setting.video_codec = video_codec
    if audio_codec:
        setting.audio_codec = audio_codec
    setting.with_suffix = with_suffix
    output_path = setting.output_path

    if output_path.is_dir():
        raise ValueError('output_path cannot be a directory')

    output_path.parent.mkdir(parents=True, exist_ok=True)
    if output_path.exists():
        if setting.skip_existing:
            print(f'skip existing file: "{output_path}"')
            return
        if not setting.overwrite:
            raise FileExistsError(
                f'output_path "{output_path}" already exists. Use --overwrite, -y to overwrite it.'
            )

    args = compile_commandline(setting, input_path, output_path)
    await run_ffmpeg(args)


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

    await run_ffmpeg(args)


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

    flow = Flow.model_validate(
        yaml.safe_load(flow_path.open()), context={'setting': setting}
    )

    pending_tasks = []
    for index, job in enumerate(flow.jobs):
        job_name = job.name or f'[Unnamed Job]'
        print(f'Job #{index} {job_name}')

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
                print(f'Skip existing file: "{job.setting.output_path}"')
                continue

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
            await run_ffmpeg(args)
        else:
            task = asyncio.create_task(run_ffmpeg(args))
            pending_tasks.append(task)

    if pending_tasks:
        await asyncio.gather(*pending_tasks)

    if not flow.setting.keep_temp:
        for job in flow.jobs:
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
    await run_ffmpeg(args)


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


def timedelta_to_padded_str(td: timedelta):
    total_seconds = int(td.total_seconds())
    hours = total_seconds // 3600
    minutes = (total_seconds % 3600) // 60
    seconds = total_seconds % 60
    return f'PT{hours:02}H{minutes:02}M{seconds:02}S'


async def run_ffmpeg(args):
    process = await asyncio.create_subprocess_exec(
        *[str(arg) for arg in args],
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )

    async def stream_output(stream):
        buf = b""
        while True:
            chunk = await stream.read(1)
            if not chunk:
                break
            print(chunk.decode('utf-8', errors='replace'), end='', flush=True)
            # if chunk == b"\r":
            #     print(buf.decode().rstrip(), end="\r", flush=True)
            #     buf = b""
            # elif chunk == b"\n":
            #     print(buf.decode().rstrip())
            #     buf = b""
            # else:
            #     buf += chunk

    tasks = [
        asyncio.create_task(stream_output(process.stdout)),
        asyncio.create_task(stream_output(process.stderr)),
    ]
    await asyncio.gather(*tasks)
    await process.wait()
    if process.returncode != 0:
        raise RuntimeError(f'ffmpeg exited with code {process.returncode}')

    return process


if __name__ == '__main__':
    app()
