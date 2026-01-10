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
            for job in self.jobs:
                job.setting = Setting.model_validate(
                    parent_setting | job.setting.model_dump(exclude_unset=True)
                )
        return self
