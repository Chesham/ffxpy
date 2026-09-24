import hashlib
import os
import shutil
import tempfile
import uuid
from datetime import timedelta
from pathlib import Path

import pydantic
import pydantic_settings


def is_directory_writable(directory: Path) -> bool:
    if not directory.exists() or not directory.is_dir():
        return False
    test_file = directory / f'.ffxpy_write_test_{uuid.uuid4().hex}'
    try:
        test_file.touch(exist_ok=False)
        test_file.unlink(missing_ok=True)
        return True
    except (OSError, PermissionError):
        return False


def get_temp_cache_dir(input_path: Path) -> Path:
    resolved_path = str(input_path.resolve())
    path_hash = hashlib.sha256(resolved_path.encode('utf-8')).hexdigest()[:12]
    cache_dir = Path(tempfile.gettempdir()) / 'ffxpy' / f'cache_{path_hash}'
    cache_dir.mkdir(parents=True, exist_ok=True)
    return cache_dir


def get_default_concurrency() -> int:
    try:
        # os.cpu_count() typically returns logical cores (threads)
        # Empirical data shows that for encoding, concurrency=2 is often optimal
        # even on 32-core/64-thread machines.
        cores = os.cpu_count() or 1
        if cores >= 32:
            return 2
    except Exception:
        pass
    return 1


class Setting(pydantic_settings.BaseSettings):
    model_config = pydantic_settings.SettingsConfigDict(
        env_file='.env',
        env_prefix='FFXPY_',
        extra='ignore',
        case_sensitive=False,
    )
    app_name: str = 'ffxpy'
    log_level: str = 'INFO'
    working_dir: Path | None = None
    output_dir: Path | None = None
    output_path: Path | None = None
    input_path: Path | None = None
    ffmpeg_path: str = ''
    ffprobe_path: str = ''
    video_codec: str = 'copy'
    video_bitrate: str | None = None
    audio_codec: str = 'copy'
    audio_bitrate: str | None = None
    maxrate: str | None = None
    bufsize: str | None = None
    preset: str | None = None
    rc: str = 'vbr'
    start: timedelta | None = None
    end: timedelta | None = None
    dry_run: bool = False
    concurrency: int = pydantic.Field(default_factory=get_default_concurrency)
    overwrite: bool = False
    skip_existing: bool = False
    with_suffix: bool = True
    with_split: bool = True
    scale: str | None = None
    crop: str | None = None
    fps: str | None = None
    merge_paths: list[Path] = pydantic.Field(default_factory=list)
    keep_temp: bool = False
    skip_validation: bool = False
    deinterlace: bool = False

    @pydantic.field_validator(
        'working_dir', 'output_dir', 'output_path', 'input_path', mode='before'
    )
    @classmethod
    def path_validator(cls, v: str | Path | None) -> str | Path | None:
        if not v:
            return v
        if isinstance(v, Path):
            return v
        return v.replace('\\', '/')

    @pydantic.model_validator(mode='after')
    def validator(self):
        if not self.ffmpeg_path:
            ffmpeg_path = shutil.which('ffmpeg')
            if ffmpeg_path is None:
                raise ValueError('ffmpeg not found in PATH')
            self.ffmpeg_path = ffmpeg_path

        # Check if the provided ffmpeg_path exists and is executable
        if not os.path.isfile(self.ffmpeg_path):
            raise ValueError(f'ffmpeg not found at: {self.ffmpeg_path}')
        if not os.access(self.ffmpeg_path, os.X_OK):
            raise ValueError(f'ffmpeg at {self.ffmpeg_path} is not executable')

        if not self.ffprobe_path:
            ffprobe_path = shutil.which('ffprobe')
            if ffprobe_path is None:
                raise ValueError('ffprobe not found in PATH')
            self.ffprobe_path = ffprobe_path

        # Check if the provided ffprobe_path exists and is executable
        if not os.path.isfile(self.ffprobe_path):
            raise ValueError(f'ffprobe not found at: {self.ffprobe_path}')
        if not os.access(self.ffprobe_path, os.X_OK):
            raise ValueError(f'ffprobe at {self.ffprobe_path} is not executable')

        # crop/scale/fps require a real filter graph, which ffmpeg rejects
        # alongside `-c:v copy` ("Filtering and streamcopy cannot be used
        # together") -- deliberately not auto-switched to a real codec here.
        # That decision belongs to the user, not this layer: it used to
        # silently flip video_codec to libx264, which fought explicit
        # video_codec=copy elsewhere (e.g. a merge job inheriting a filter
        # setting) and made ffmpeg's own failure the only honest signal when
        # a user's chosen combination genuinely doesn't work.

        if self.video_codec != 'copy' and not self.video_bitrate:
            raise ValueError('video_bitrate must be set when video_codec is not "copy"')

        if self.audio_codec != 'copy' and not self.audio_bitrate:
            raise ValueError('audio_bitrate must be set when audio_codec is not "copy"')

        if not self.working_dir and self.input_path:
            candidate_dir = self.input_path.resolve().parent
            if is_directory_writable(candidate_dir):
                self.working_dir = candidate_dir
            else:
                self.working_dir = get_temp_cache_dir(self.input_path)

        return self

    def __repr__(self):
        return self.model_dump_json()

    def __str__(self):
        return self.__repr__()
