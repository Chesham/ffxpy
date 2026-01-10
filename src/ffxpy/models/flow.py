from pathlib import Path

import isodate
import pydantic

from ffxpy.const import Command
from ffxpy.setting import Setting


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
            # Reset input_path to None for merge jobs to prevent inheritance from flow settings
            if not self.setting.input_path:
                self.setting.input_path = None
        return self


class Flow(pydantic.BaseModel):
    setting: Setting | None = None
    jobs: list[FlowJob] = pydantic.Field(default_factory=list)

    @pydantic.model_validator(mode='after')
    def validator(self):
        if self.setting:
            parent_setting = self.setting.model_dump(exclude_unset=True)
            for idx, job in enumerate(self.jobs):
                job.setting = Setting.model_validate(
                    parent_setting | job.setting.model_dump(exclude_unset=True)
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

        return self


def split_normalize(setting: Setting):
    input_path = setting.input_path
    output_path = setting.output_path
    if not output_path:
        if setting.with_suffix:
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

    setting.output_path = output_path

    return setting


def merge_normalize(setting: Setting, merge_paths: list[Path] | None = None):
    if not setting.merge_paths:
        if merge_paths:
            setting.merge_paths = merge_paths
        elif setting.with_split:
            setting.merge_paths = sorted(
                setting.working_dir.glob('*_split_*', case_sensitive=False)
            )

    setting.input_path = (
        setting.input_path or setting.working_dir / 'ffxpy_merge_list.txt'
    )

    if not setting.output_path:
        filename = f'{setting.merge_paths[0].stem.split("_split")[0]}{setting.merge_paths[0].suffix}'
        if setting.output_dir:
            setting.output_path = setting.output_dir / filename
        elif setting.working_dir:
            setting.output_path = setting.working_dir / filename
        else:
            raise ValueError('no output path specified')

    if setting.output_path.parent == setting.working_dir:
        setting.output_path = setting.output_path.with_stem(
            f'{setting.output_path.stem}_merged'
        )

    return setting
