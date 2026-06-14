import asyncio
from collections import defaultdict
from functools import wraps
from typing import Awaitable, Callable, Literal, Union

import click
import typer

EventType = Literal['startup', 'shutdown']
EventHandler = Union[
    Callable[[click.Context], None], Callable[[click.Context], Awaitable[None]]
]


class AsyncTyper(typer.Typer):
    event_handlers: defaultdict[EventType, list[EventHandler]] = defaultdict(list)

    def async_command(self, *args, **kwargs):
        def decorator(async_func):
            @wraps(async_func)
            def sync_func(*_args, **_kwargs):
                # Try to get the context safely
                ctx = None
                try:
                    ctx = click.get_current_context()
                except (RuntimeError, AttributeError):
                    # Try to find it in arguments (Typer might have passed it)
                    for arg in _args:
                        if isinstance(arg, click.Context):
                            ctx = arg
                            break

                async def wrapped():
                    # Re-push context inside the async loop (important for Windows/Asyncio)
                    if ctx:
                        with ctx:
                            await self.run_event_handlers('startup', ctx)
                            try:
                                return await async_func(*_args, **_kwargs)
                            finally:
                                await self.run_event_handlers('shutdown', ctx)
                    else:
                        # Fallback if no context is found
                        return await async_func(*_args, **_kwargs)

                return asyncio.run(wrapped())

            self.command(*args, **kwargs)(sync_func)
            return async_func

        return decorator

    def add_event_handler(self, event_type: EventType, func: EventHandler) -> None:
        self.event_handlers[event_type].append(func)

    async def run_event_handlers(self, event_type: EventType, ctx: click.Context):
        for event in self.event_handlers[event_type]:
            if asyncio.iscoroutinefunction(event):
                await event(ctx)
            else:
                event(ctx)
