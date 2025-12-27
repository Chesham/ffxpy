from typing import cast

from ffxpy.setting import Setting


class Context:
    def __init__(self, setting: Setting | None = None):
        self.setting = setting or Setting()


def solve_context(src):
    return cast(Context, src.meta['context'])
