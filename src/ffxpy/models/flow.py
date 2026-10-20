from datetime import timedelta
from pathlib import Path

import isodate
import pydantic

from ffxpy.const import Command
from ffxpy.setting import Setting, get_temp_cache_dir, is_directory_writable


def _format_duration_for_filename(td: timedelta) -> str:
    # HH-MM-SS.mmm -- dashes instead of colons since Windows filenames can't
    # contain ":", millisecond (not microsecond) precision keeps it readable.
    total_ms = round(td.total_seconds() * 1000)
    hours, rem_ms = divmod(total_ms, 3_600_000)
    minutes, rem_ms = divmod(rem_ms, 60_000)
    seconds, ms = divmod(rem_ms, 1000)
    return f'{hours:02d}-{minutes:02d}-{seconds:02d}.{ms:03d}'


class FlowJob(pydantic.BaseModel):
    name: str | None = None
    command: Command
    setting: Setting

    @pydantic.model_validator(mode='before')
    @classmethod
    def before_validator(cls, data, info: pydantic.ValidationInfo):
        return info.context | data if info.context else data

    @pydantic.model_validator(mode='after')
    def validator(self):
        if self.command == Command.MERGE:
            # Reset input_path to None for merge jobs
            # to prevent inheritance from flow settings
            if not self.setting.input_path:
                self.setting.input_path = None
        return self


class Flow(pydantic.BaseModel):
    setting: Setting = pydantic.Field(default_factory=Setting)
    jobs: list[FlowJob] = pydantic.Field(default_factory=list)

    @pydantic.model_validator(mode='before')
    @classmethod
    def before_validator(cls, data, info: pydantic.ValidationInfo):
        if not isinstance(data, dict):
            return data
        context_setting = info.context.get('setting') if info.context else None
        if context_setting and isinstance(context_setting, Setting):
            # Merge context setting with data['setting'] if exists
            yaml_setting_data = data.get('setting', {})
            merged_setting = (
                context_setting.model_dump(exclude_unset=True) | yaml_setting_data
            )
            data['setting'] = merged_setting
        return data

    @pydantic.model_validator(mode='after')
    def validator(self):
        if self.setting:
            parent_setting = self.setting.model_dump(exclude_unset=True)
            for idx, job in enumerate(self.jobs):
                inherited_setting = parent_setting
                if job.command == Command.MERGE:
                    # crop/scale/fps describe how to re-encode an individual clip;
                    # a merge job just concatenates already-processed clips, so
                    # inheriting these from the flow-level setting would silently
                    # add a video filter to a job whose video_codec is explicitly
                    # copy -- ffmpeg rejects filters combined with stream copy, so
                    # a merge job that never asked for these would fail anyway.
                    inherited_setting = {
                        k: v
                        for k, v in parent_setting.items()
                        if k not in ('crop', 'scale', 'fps')
                    }
                job.setting = Setting.model_validate(
                    inherited_setting | job.setting.model_dump(exclude_unset=True)
                )

                if job.command == Command.SPLIT:
                    job.setting = split_normalize(job.setting)

                if job.command == Command.MERGE:
                    job.setting = merge_normalize(
                        job.setting,
                        merge_paths=[
                            i.setting.output_path
                            for i in self.jobs[:idx]
                            if i.setting.output_path
                        ],
                    )

                if job.command == Command.CROP:
                    job.setting = crop_normalize(job.setting)

        return self


def crop_normalize(setting: Setting):
    input_path = setting.input_path
    if not input_path:
        return setting

    output_path = setting.output_path
    if not output_path:
        # Without start/end in the stem, multiple crop jobs on the same
        # source (e.g. cropping out several segments to merge later) all
        # resolve to the same "{stem}_cropped" path and silently overwrite
        # each other -- mirror split_normalize's disambiguation.
        stem = f'{input_path.stem}_cropped'
        # `is not None`, not truthiness -- timedelta(0) (start: 00:00:00) is
        # falsy and would otherwise silently drop out of the filename.
        if setting.start is not None:
            stem += f'_{_format_duration_for_filename(setting.start)}'
        if setting.end is not None:
            stem += f'_{_format_duration_for_filename(setting.end)}'
        output_path = input_path.with_stem(stem)

    if setting.temp_dir:
        output_path = setting.temp_dir / output_path.name
    elif setting.output_dir:
        output_path = setting.output_dir / output_path.name
    elif setting.working_dir:
        output_path = setting.working_dir / output_path.name

    setting.output_path = output_path
    return setting


def split_normalize(setting: Setting):
    input_path = setting.input_path
    if not input_path:
        return setting

    output_path = setting.output_path
    if not output_path:
        if setting.with_suffix:
            stem = f'{input_path.stem}_split'
            # `is not None`, not truthiness -- timedelta(0) (start: 00:00:00)
            # is falsy and would otherwise silently drop out of the filename.
            if setting.start is not None:
                stem += (
                    f'_{isodate.duration_isoformat(setting.start, "PT%HH%MM%S.%fS")}'
                )
            if setting.end is not None:
                stem += f'_{isodate.duration_isoformat(setting.end, "PT%HH%MM%S.%fS")}'
            output_path = input_path.with_stem(stem)
        else:
            output_path = Path(input_path.name)

    if setting.temp_dir:
        output_path = setting.temp_dir / output_path.name
    elif setting.output_dir:
        output_path = setting.output_dir / output_path.name
    elif setting.working_dir:
        output_path = setting.working_dir / output_path.name

    setting.output_path = output_path

    return setting


def merge_normalize(setting: Setting, merge_paths: list[Path] | None = None):
    working_dir = setting.temp_dir or setting.working_dir or Path('.')
    if not setting.merge_paths:
        if merge_paths:
            setting.merge_paths = merge_paths
        elif setting.with_split:
            setting.merge_paths = sorted(
                working_dir.glob('*_split_*', case_sensitive=False)
            )

    if not setting.working_dir and not setting.temp_dir and setting.merge_paths:
        candidate_dir = setting.merge_paths[0].resolve().parent
        if is_directory_writable(candidate_dir):
            working_dir = candidate_dir
        else:
            working_dir = get_temp_cache_dir(setting.merge_paths[0])

    if not setting.input_path or setting.input_path.suffix.lower() != '.txt':
        setting.input_path = working_dir / 'ffxpy_merge_list.txt'

    if not setting.output_path and setting.merge_paths:
        # Reduce back to the original source's base name, same as the
        # split case -- otherwise a crop-sourced merge would carry the
        # cropped clip's own "_cropped_<start>_<end>" suffix straight into
        # the merged output's filename.
        stem = setting.merge_paths[0].stem
        for marker in ('_split', '_cropped'):
            stem = stem.split(marker)[0]
        suffix = setting.merge_paths[0].suffix
        filename = f'{stem}{suffix}'
        if setting.output_dir:
            setting.output_path = setting.output_dir / filename
        elif working_dir:
            setting.output_path = working_dir / filename
        else:
            raise ValueError('no output path specified')

    if setting.output_path and setting.output_path.parent == working_dir:
        setting.output_path = setting.output_path.with_stem(
            f'{setting.output_path.stem}_merged'
        )

    return setting
