"""Keyframe-aligned, on-demand MPEG-TS HLS preview.

Each segment uses the real GOP boundaries discovered from the source rather
than an arbitrary wall-clock cut. The media itself is always stream copied.
"""
import asyncio
from bisect import bisect_left
import hashlib
import json
import math
import os
import tempfile
from pathlib import Path
from urllib.parse import quote

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse, Response

from ffxpy.probe import input_format_args, probe_video

router = APIRouter(prefix='/api/hls')
SEGMENT_SECONDS = 8
WINDOW_SEGMENTS = 5
MAX_CACHE_BYTES = 256 * 1024 * 1024
_cache_dir: Path | None = None
_locks: dict[str, asyncio.Lock] = {}


def configure_cache(directory: Path) -> None:
    global _cache_dir
    _cache_dir = directory / 'hls'
    _cache_dir.mkdir(parents=True, exist_ok=True)


def source_key(path: Path) -> str:
    stat = path.stat()
    return hashlib.sha256(
        f'{path.resolve()}:{stat.st_size}:{stat.st_mtime_ns}:hlsmux-v2'.encode()
    ).hexdigest()[:24]


def cache_path(path: Path, index: int) -> Path:
    if _cache_dir is None:
        raise RuntimeError('HLS cache not configured')
    return _cache_dir / f'{source_key(path)}_{index:05d}.ts'


def evict_cache(exclude: Path) -> None:
    if _cache_dir is None:
        return
    files = sorted(
        (p for p in _cache_dir.glob('*.ts') if p != exclude),
        key=lambda p: p.stat().st_mtime,
    )
    used = exclude.stat().st_size if exclude.exists() else 0
    used += sum(p.stat().st_size for p in files)
    for file in files:
        if used <= MAX_CACHE_BYTES:
            break
        try:
            size = file.stat().st_size
            file.unlink()
            used -= size
        except OSError:
            continue


def hls_durations(playlist: Path) -> list[float]:
    """Read FFmpeg's actual segment durations, not just the file count."""
    try:
        return [
            float(line.split(':', 1)[1].rstrip(','))
            for line in playlist.read_text(encoding='utf-8').splitlines()
            if line.startswith('#EXTINF:')
        ]
    except (OSError, ValueError):
        return []


def durations_match(actual: list[float], expected: list[float]) -> bool:
    """Reject segment profiles that would drift from the published VOD timeline."""
    return len(actual) == len(expected) and all(
        abs(a - b) <= 0.25 for a, b in zip(actual, expected)
    )


def make_boundaries(keyframes: list[float], duration: float) -> list[float]:
    """Choose native-HLS-compatible GOP boundaries within short windows.

    Keyframes are relative to the input's first video timestamp, not raw
    MPEG-TS PTS (which often begins at 1.4s). Never invent a boundary in
    the middle of a GOP.
    """
    if not math.isfinite(duration) or duration <= 0:
        raise ValueError('Invalid media duration')
    ordered = sorted(set(round(t, 6) for t in keyframes if math.isfinite(t) and 0 <= t < duration))
    if not ordered or ordered[0] > 0.1:
        raise ValueError('Video has no valid starting keyframe')
    boundaries = [0.0]
    # Match FFmpeg HLS muxer's target-time rule for each independent window.
    while boundaries[-1] + SEGMENT_SECONDS < duration:
        window_start = boundaries[-1]
        for n in range(1, WINDOW_SEGMENTS + 1):
            threshold = window_start + n * SEGMENT_SECONDS
            if threshold >= duration:
                break
            candidate = bisect_left(ordered, round(threshold, 6) - 0.0001)
            if candidate >= len(ordered):
                break
            next_boundary = ordered[candidate]
            if next_boundary >= duration or next_boundary <= boundaries[-1]:
                break
            boundaries.append(next_boundary)
        if boundaries[-1] == window_start:
            break
    if duration - boundaries[-1] < 0.2 and len(boundaries) > 1:
        boundaries.pop()
    boundaries.append(duration)
    return boundaries


def playlist_text(path: Path, boundaries: list[float]) -> str:
    if len(boundaries) < 2:
        raise HTTPException(status_code=422, detail='No keyframe-aligned segments')
    encoded = quote(str(path), safe='')
    lengths = [b - a for a, b in zip(boundaries, boundaries[1:])]
    lines = [
        '#EXTM3U', '#EXT-X-VERSION:3',
        f'#EXT-X-TARGETDURATION:{math.ceil(max(lengths))}',
        '#EXT-X-MEDIA-SEQUENCE:0',
        '#EXT-X-PLAYLIST-TYPE:VOD',
    ]
    for index, span in enumerate(lengths):
        if index and index % WINDOW_SEGMENTS == 0:
            # Separate FFmpeg processes may have slightly different audio
            # preroll. HLS discontinuities only occur between ~50s windows,
            # never at every 8-10s GOP boundary.
            lines.append('#EXT-X-DISCONTINUITY')
        lines.append(f'#EXTINF:{span:.6f},')
        lines.append(f'segment?path={encoded}&index={index}')
    lines.append('#EXT-X-ENDLIST')
    return '\n'.join(lines) + '\n'


async def validate_ts(path: Path, ffprobe_path: str):
    if not path.is_file():
        raise HTTPException(status_code=404, detail='File not found')
    info = await probe_video(path, ffprobe_path)
    if 'mpegts' not in info.format_name:
        raise HTTPException(status_code=415, detail='Only MPEG-TS is supported')
    if not any(s.codec_type == 'video' and s.codec_name == 'h264' for s in info.streams):
        raise HTTPException(status_code=415, detail='HLS stream copy requires H.264')
    return info


async def segment_boundaries(path: Path, ffprobe_path: str) -> list[float]:
    if _cache_dir is None:
        raise RuntimeError('HLS cache not configured')
    from ffxpy.web.main import settings

    info = await validate_ts(path, ffprobe_path)
    duration = info.duration.total_seconds()
    metadata = _cache_dir / f'{source_key(path)}.json'
    lock = _locks.setdefault(str(metadata), asyncio.Lock())
    async with lock:
        if metadata.exists():
            try:
                saved = json.loads(metadata.read_text())
                if saved['duration'] == duration:
                    return saved['boundaries']
            except (OSError, ValueError, KeyError, TypeError):
                pass

        # Decode only keyframes, not the entire video. The result is cached
        # based on path, file size, modification time and algorithm version.
        cmd = [
            ffprobe_path, '-v', 'error', '-skip_frame', 'nokey',
            '-select_streams', 'v:0', '-show_entries',
            'frame=best_effort_timestamp_time', '-of', 'csv=p=0',
            *input_format_args(path), str(path),
        ]
        process = await asyncio.create_subprocess_exec(
            *cmd, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
        )
        try:
            stdout, stderr = await asyncio.wait_for(process.communicate(), timeout=120)
        except asyncio.TimeoutError:
            process.kill()
            await process.wait()
            raise HTTPException(status_code=504, detail='Keyframe scan timed out') from None
        if process.returncode:
            raise HTTPException(
                status_code=422, detail=f'Keyframe scan failed: {stderr.decode(errors="replace")[-800:]}'
            )
        pts = []
        for line in stdout.decode(errors='replace').splitlines():
            try:
                pts.append(float(line.strip().rstrip(',')))
            except ValueError:
                continue
        if not pts:
            raise HTTPException(status_code=422, detail='No keyframes detected')
        origin = pts[0]
        # FFprobe reports raw MPEG-TS PTS, usually with a non-zero origin.
        try:
            boundaries = make_boundaries([t - origin for t in pts], duration)
        except ValueError as error:
            raise HTTPException(status_code=422, detail=str(error)) from None
        part = metadata.with_suffix('.partial.json')
        part.write_text(json.dumps({'duration': duration, 'boundaries': boundaries}))
        os.replace(part, metadata)
        return boundaries


@router.get('/playlist.m3u8')
async def playlist(path: str):
    from ffxpy.web.main import settings

    source = Path(path)
    boundaries = await segment_boundaries(source, settings.ffprobe_path)
    return Response(
        playlist_text(source, boundaries),
        media_type='application/vnd.apple.mpegurl',
        headers={'Cache-Control': 'no-store'},
    )


@router.get('/segment')
async def segment(path: str, index: int):
    from ffxpy.web.main import settings

    source = Path(path)
    if index < 0:
        raise HTTPException(status_code=400, detail='Invalid segment index')
    boundaries = await segment_boundaries(source, settings.ffprobe_path)
    if index >= len(boundaries) - 1:
        raise HTTPException(status_code=404, detail='Segment out of range')
    # One native HLS muxer splits each short window continuously.
    # Independent per-segment FFmpeg invocations introduced overlapping DTS
    # packets at every boundary. Only window transitions need discontinuity.
    first = (index // WINDOW_SEGMENTS) * WINDOW_SEGMENTS
    last = min(first + WINDOW_SEGMENTS, len(boundaries) - 1)
    targets = [cache_path(source, offset) for offset in range(first, last)]
    target = cache_path(source, index)
    lock = _locks.setdefault(f'{source_key(source)}:window:{first}', asyncio.Lock())
    async with lock:
        if any(not p.is_file() or p.stat().st_size == 0 for p in targets):
            if _cache_dir is None:
                raise RuntimeError('HLS cache not configured')
            start = boundaries[first]
            end = boundaries[last]
            with tempfile.TemporaryDirectory(prefix='hls_window_', dir=_cache_dir) as directory:
                playlist_file = str(Path(directory) / 'window.m3u8')
                pattern = str(Path(directory) / 'part_%03d.ts')
                # The next window starts on this exact keyframe. Exclude
                # the boundary frame to prevent an extra tiny fragment.
                span = end - start
                if last < len(boundaries) - 1:
                    span = max(0.1, span - 0.05)
                expected_durations = [
                    boundaries[i + 1] - boundaries[i] for i in range(first, last)
                ]
                # FFmpeg's HLS muxer can choose a different starting GOP
                # after seeking a TS with irregular PTS. In particular this
                # may produce *six* fragments when our VOD manifest advertises
                # five. Select a time profile whose actual EXTINF values
                # agree with the manifest; otherwise use exact split_times.
                parts: list[Path] = []
                error = b''
                for target_seconds in (
                    float(SEGMENT_SECONDS), 8.75, 8.5, 9.0, 8.25, 9.25, 7.75
                ):
                    for previous in Path(directory).glob('part_*.ts'):
                        previous.unlink()
                    cmd = [
                        settings.ffmpeg_path, '-hide_banner', '-loglevel', 'error',
                        '-y', '-ss', f'{start:.6f}', *input_format_args(source),
                        '-i', str(source), '-t', f'{span:.6f}',
                        '-map', '0:v:0', '-map', '0:a:0?', '-c', 'copy',
                        '-output_ts_offset', f'{start:.6f}',
                        '-f', 'hls', '-hls_time', str(target_seconds),
                        '-hls_list_size', '0', '-hls_playlist_type', 'vod',
                        '-hls_flags', 'independent_segments',
                        '-hls_segment_filename', pattern, playlist_file,
                    ]
                    process = await asyncio.create_subprocess_exec(
                        *cmd, stdout=asyncio.subprocess.DEVNULL,
                        stderr=asyncio.subprocess.PIPE,
                    )
                    try:
                        _, error = await asyncio.wait_for(process.communicate(), timeout=90)
                    except asyncio.TimeoutError:
                        process.kill()
                        await process.wait()
                        raise HTTPException(
                            status_code=504, detail='HLS window remux timed out'
                        ) from None
                    parts = sorted(Path(directory).glob('part_*.ts'))
                    if (
                        process.returncode == 0
                        and durations_match(
                            hls_durations(Path(playlist_file)), expected_durations
                        )
                        and len(parts) == len(targets)
                        and all(p.stat().st_size > 0 for p in parts)
                    ):
                        break
                else:
                    # Recover playable output even when the source's PTS/GOP
                    # layout cannot be represented by the native HLS cadence.
                    # The generic segment muxer follows our explicit
                    # keyframe-aligned split times; it may have minor boundary
                    # artifacts but must not cause a permanent HTTP 422.
                    for previous in Path(directory).glob('part_*.ts'):
                        previous.unlink()
                    split_times = [
                        f'{boundaries[i] - start:.6f}'
                        for i in range(first + 1, last)
                    ]
                    cmd = [
                        settings.ffmpeg_path, '-hide_banner', '-loglevel', 'error',
                        '-y', '-ss', f'{start:.6f}', *input_format_args(source),
                        '-i', str(source), '-t', f'{span:.6f}',
                        '-map', '0:v:0', '-map', '0:a:0?', '-c', 'copy',
                        '-output_ts_offset', f'{start:.6f}',
                        '-f', 'segment', '-segment_format', 'mpegts',
                        '-segment_time_delta', '0.04',
                        '-reset_timestamps', '0',
                    ]
                    if split_times:
                        cmd += ['-segment_times', ','.join(split_times)]
                    cmd += [pattern]
                    process = await asyncio.create_subprocess_exec(
                        *cmd, stdout=asyncio.subprocess.DEVNULL,
                        stderr=asyncio.subprocess.PIPE,
                    )
                    try:
                        _, error = await asyncio.wait_for(process.communicate(), timeout=90)
                    except asyncio.TimeoutError:
                        process.kill()
                        await process.wait()
                        raise HTTPException(
                            status_code=504, detail='HLS fallback remux timed out'
                        ) from None
                    parts = sorted(Path(directory).glob('part_*.ts'))
                    if process.returncode != 0:
                        raise HTTPException(
                            status_code=422,
                            detail=(
                                'HLS window and fallback failed: '
                                + error.decode(errors='replace')[-1000:]
                            ),
                        )
                if len(parts) != len(targets) or any(
                    p.stat().st_size == 0 for p in parts
                ):
                    raise HTTPException(
                        status_code=422,
                        detail=(
                            f'HLS remux produced {len(parts)}/{len(targets)} '
                            'nonempty segments; '
                            + error.decode(errors='replace')[-1000:]
                        ),
                    )
                for part, destination in zip(parts, targets):
                    os.replace(part, destination)
            evict_cache(target)
        target.touch()
    return FileResponse(target, media_type='video/mp2t')
