import asyncio
import json
from datetime import timedelta
from pathlib import Path

import pydantic


class StreamInfo(pydantic.BaseModel):
    index: int
    codec_type: str
    codec_name: str | None = None
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
            codec_name=s.get('codec_name'),
            width=s.get('width'),
            height=s.get('height'),
        )
        for s in streams_data
    ]

    duration_str = format_data.get('duration')
    duration = timedelta(seconds=float(duration_str)) if duration_str else timedelta(0)

    return VideoInfo(
        format_name=format_data['format_name'],
        duration=duration,
        size=int(format_data['size']),
        streams=streams,
    )
