import asyncio
import json
import re
from datetime import timedelta
from pathlib import Path

import pydantic


class StreamInfo(pydantic.BaseModel):
    index: int
    codec_type: str
    codec_name: str | None = None
    width: int | None = None
    height: int | None = None
    field_order: str | None = None
    bit_rate: int | None = None
    r_frame_rate: str | None = None


class VideoInfo(pydantic.BaseModel):
    format_name: str
    duration: timedelta
    size: int
    bit_rate: int | None = None
    streams: list[StreamInfo]


def is_interlaced(info: VideoInfo) -> bool:
    for stream in info.streams:
        if stream.codec_type == 'video':
            # Check field_order which is the standard way
            if (
                stream.field_order
                and stream.field_order != 'progressive'
                and stream.field_order != 'unknown'
            ):
                return True
    return False


async def detect_interlacing_heavily(path: Path, ffmpeg_path: str = 'ffmpeg') -> bool:
    """
    Use idet filter to detect interlacing by analyzing actual frames.
    Skips the first 5 seconds to avoid static logos.
    """
    cmd = [
        ffmpeg_path,
        '-ss',
        '5',  # Skip first 5 seconds
        '-i',
        str(path),
        '-vf',
        'idet',
        '-frames:v',
        '300',  # Scan 300 frames
        '-an',
        '-f',
        'null',
        '-',
    ]
    process = await asyncio.create_subprocess_exec(
        *cmd, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE
    )
    _, stderr = await process.communicate()
    output = stderr.decode()

    # Look for idet summary in stderr
    # Typical output: TFF: 100 BFF: 0 Progressive: 50 Undetermined: 150
    match = re.search(r'TFF:\s*(\d+)\s*BFF:\s*(\d+)\s*Progressive:\s*(\d+)', output)
    if match:
        tff, bff, progressive = map(int, match.groups())

        # If we see ANY interlaced fields, or if interlaced > progressive
        # We are very aggressive here because deinterlace was specifically asked
        if (tff > 5 or bff > 5) or (tff + bff > progressive):
            return True

    # Fallback: check if the output contains "Single frame detection"
    if 'TFF:' in output or 'BFF:' in output:
        # Check for any non-zero TFF/BFF in the whole output
        it_match = re.search(r'TFF:\s*([1-9]\d*)', output) or re.search(
            r'BFF:\s*([1-9]\d*)', output
        )
        if it_match:
            return True

    return False


def is_png_prefixed_mpegts(path: Path) -> bool:
    """Identify MPEG-TS packets hidden behind a tiny PNG prefix.

    Some capture tools prepend a 1x1 PNG to a transport stream. FFprobe
    auto-detects png_pipe instead of the actual transport stream.
    Require several aligned 188-byte sync bytes to avoid treating normal
    PNG files as MPEG-TS.
    """
    if path.suffix.lower() not in {'.ts', '.m2ts', '.mts'}:
        return False
    try:
        with path.open('rb') as source:
            head = source.read(8192)
        if not head.startswith(b'\x89PNG\r\n\x1a\n'):
            return False
        for offset in range(8, min(2048, len(head) - 376)):
            if all(head[offset + step * 188] == 0x47 for step in range(3)):
                return True
    except OSError:
        return False
    return False


def input_format_args(path: Path) -> list[str]:
    return ['-f', 'mpegts'] if is_png_prefixed_mpegts(path) else []


async def probe_video(path: Path, ffprobe_path: str = 'ffprobe') -> VideoInfo:
    cmd = [
        ffprobe_path,
        '-v',
        'quiet',
        '-print_format',
        'json',
        '-show_format',
        '-show_streams',
        '-find_stream_info',
        *input_format_args(path),
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
            field_order=s.get('field_order'),
            bit_rate=int(s.get('bit_rate')) if s.get('bit_rate') else None,
            r_frame_rate=s.get('r_frame_rate'),
        )
        for s in streams_data
    ]

    duration_str = format_data.get('duration')
    duration = timedelta(seconds=float(duration_str)) if duration_str else timedelta(0)

    # Try to find the video stream's bit rate first
    video_stream = next((s for s in streams if s.codec_type == 'video'), None)
    if video_stream and video_stream.bit_rate:
        bit_rate = video_stream.bit_rate
    else:
        # Fallback to overall format bit rate
        bit_rate_str = format_data.get('bit_rate')
        bit_rate = int(bit_rate_str) if bit_rate_str else None

    return VideoInfo(
        format_name=format_data['format_name'],
        duration=duration,
        size=int(format_data['size']),
        bit_rate=bit_rate,
        streams=streams,
    )
