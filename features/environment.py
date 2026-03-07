import shutil
import subprocess
import tempfile
from pathlib import Path


def create_dummy_video(path: Path, duration: int = 5):
    # Create a simple 1 second video with color and sine wave audio
    # Using low resolution and simple settings to keep it fast
    cmd = [
        'ffmpeg',
        '-y',
        '-f',
        'lavfi',
        '-i',
        f'color=c=blue:s=128x128:d={duration}',
        '-f',
        'lavfi',
        '-i',
        f'sine=f=440:b=4:d={duration}',
        '-vcodec',
        'libx264',
        '-t',
        str(duration),
        str(path),
    ]
    subprocess.run(cmd, capture_output=True, check=True)


def before_all(context):
    # Setup temporary directory for test files
    context.tmp_dir = Path(tempfile.mkdtemp(prefix='ffxpy_test_'))
    context.working_dir = context.tmp_dir / 'work'
    context.working_dir.mkdir()

    # Create common test files in working_dir
    context.video_5s = context.working_dir / 'test_5s.mp4'
    create_dummy_video(context.video_5s, duration=5)


def after_all(context):
    # Clean up temporary directory
    if hasattr(context, 'tmp_dir'):
        shutil.rmtree(context.tmp_dir)
