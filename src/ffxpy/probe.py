import asyncio
import json
from datetime import timedelta
from pathlib import Path

import pydantic


class StreamInfo(pydantic.BaseModel):
    index: int
    codec_type: str
    codec_name: str
    width: int | None = None
    height: int | None = None


class VideoInfo(pydantic.BaseModel):
    format_name: str
    duration: timedelta
    size: int
    streams: list[StreamInfo]


async def probe_video(path: Path, ffprobe_path: str = 'ffprobe') -> VideoInfo:
    cmd = [
        ffprobe_path,
        '-v',
        'quiet',
        '-print_format',
        'json',
        '-show_format',
        '-show_streams',
        str(path),
    ]
    process = await asyncio.create_subprocess_exec(
        *cmd, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE
    )
    stdout, stderr = await process.communicate()

    if process.returncode != 0:
        raise RuntimeError(f'ffprobe failed: {stderr.decode()}')

    data = json.loads(stdout.decode())

    format_data = data['format']
    streams_data = data['streams']

    streams = [
        StreamInfo(
            index=s['index'],
            codec_type=s['codec_type'],
            codec_name=s['codec_name'],
            width=s.get('width'),
            height=s.get('height'),
        )
        for s in streams_data
    ]

    return VideoInfo(
        format_name=format_data['format_name'],
        duration=timedelta(seconds=float(format_data['duration'])),
        size=int(format_data['size']),
        streams=streams,
    )
