import pydantic

from ffxpy.const import Command
from ffxpy.setting import Setting


class FlowJob(pydantic.BaseModel):
    name: str | None = None
    command: Command
    setting: Setting


class Flow(pydantic.BaseModel):
    jobs: list[FlowJob] = pydantic.Field(default_factory=list)
