from __future__ import annotations

import uuid
from contextvars import ContextVar
from typing import Any

import structlog

request_id_var: ContextVar[str] = ContextVar("request_id", default="")


def configure_logging(env: str = "local") -> None:
    common_processors: list[Any] = [
        structlog.contextvars.merge_contextvars,
        structlog.stdlib.filter_by_level,
        structlog.stdlib.add_log_level,
        structlog.processors.TimeStamper(fmt="iso"),
    ]
    renderer: Any = (
        structlog.dev.ConsoleRenderer()
        if env == "local"
        else structlog.processors.JSONRenderer()
    )
    structlog.configure(
        processors=[*common_processors, renderer],
        wrapper_class=structlog.stdlib.BoundLogger,
        context_class=dict,
        logger_factory=structlog.stdlib.LoggerFactory(),
        cache_logger_on_first_use=True,
    )


def get_logger() -> structlog.stdlib.BoundLogger:
    log: structlog.stdlib.BoundLogger = structlog.get_logger()
    rid: str = request_id_var.get()
    if rid:
        log = log.bind(request_id=rid)
    return log


def generate_request_id() -> str:
    return uuid.uuid4().hex[:12]


log: structlog.stdlib.BoundLogger = get_logger()
