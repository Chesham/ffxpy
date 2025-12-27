import asyncio
from datetime import datetime, timedelta
from pathlib import Path

import async_typer
import isodate
import typer

from ffxpy.context import Context, solve_context
from ffxpy.setting import Setting

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
        ctx.setting.working_dir = str(working_dir)
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
    setting = ctx.setting
    if video_codec:
        setting.video_codec = video_codec
    if audio_codec:
        setting.audio_codec = audio_codec
    setting.start = start
    setting.end = end
    output_path = setting.output_path

    if not output_path:
        if with_suffix:
            stem = f'{input_path.stem}_split'
            if setting.start:
                stem += (
                    f'_{isodate.duration_isoformat(setting.start, "PT%HH%MM%S.%fS")}'
                )
            if setting.end:
                stem += f'_{isodate.duration_isoformat(setting.end, "PT%HH%MM%S.%fS")}'
            output_path = input_path.with_stem(stem)
        else:
            output_path = Path(input_path.name)

    if setting.output_dir:
        output_path = setting.output_dir / output_path.name
    elif setting.working_dir:
        output_path = setting.working_dir / output_path.name

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
    setting = ctx.setting
    working_dir = setting.working_dir
    output_path = setting.output_path

    file_paths = []
    if working_dir:
        if not working_dir.is_dir():
            raise NotADirectoryError(f'working_dir "{working_dir}" is not a directory')
        if with_split:
            file_paths = sorted(working_dir.glob('*_split_*', case_sensitive=False))

    if not file_paths:
        raise ValueError('No files to merge.')

    list_file = working_dir / 'ffxpy_merge_list.txt'
    with list_file.open('w') as f:
        for file_path in file_paths:
            f.write(f"file '{file_path.resolve()}'\n")
    print(f'Following files will be merged: {[i.name for i in file_paths]}')

    filename = f'{file_paths[0].stem.split("_split")[0]}{file_paths[0].suffix}'
    if not output_path:
        if setting.output_dir:
            output_path = setting.output_dir / filename
        elif working_dir:
            output_path = working_dir / filename
        else:
            raise ValueError('No output path specified.')

    if output_path.parent == working_dir:
        output_path = output_path.with_stem(f'{output_path.stem}_merged')

    args = compile_commandline(
        setting,
        list_file,
        output_path,
        before_inputs={
            '-f': 'concat',
            '-safe': '0',
        },
    )
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

    return process


if __name__ == '__main__':
    app()
