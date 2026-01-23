import shutil
from datetime import timedelta
from pathlib import Path

import pydantic
import pydantic_settings


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
    overwrite: bool = False
    skip_existing: bool = False
    with_suffix: bool = True
    with_split: bool = True
    scale: str | None = None
    merge_paths: list[Path] = pydantic.Field(default_factory=list)
    keep_temp: bool = False

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
                raise ValueError(
                    'ffmpeg not found in PATH, please set FFXPY_FFMPEG_PATH in .env'
                )
            self.ffmpeg_path = ffmpeg_path

        if self.video_codec != 'copy' and not self.video_bitrate:
            raise ValueError('video_bitrate must be set when video_codec is not "copy"')

        if self.audio_codec != 'copy' and not self.audio_bitrate:
            raise ValueError('audio_bitrate must be set when audio_codec is not "copy"')

        if not self.working_dir and self.input_path:
            self.working_dir = self.input_path.parent

        return self

    def __repr__(self):
        return self.model_dump_json()

    def __str__(self):
        return self.__repr__()
