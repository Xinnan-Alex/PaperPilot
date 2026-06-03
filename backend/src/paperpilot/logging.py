from __future__ import annotations

import logging
import os
import sys
import uuid
from contextvars import ContextVar
from typing import Any

import structlog

request_id_var: ContextVar[str] = ContextVar("request_id", default="")


def configure_logging(env: str = "local") -> None:
    """Configure structlog and the stdlib logging root so all logs share format.

    Uvicorn, LiteLLM, httpx, etc. write to stdlib logging. We route them through
    structlog's ProcessorFormatter so they end up in the same JSON/console shape
    as our own `log.info(...)` calls.
    """
    log_level = os.getenv("LOG_LEVEL", "INFO").upper()

    timestamper = structlog.processors.TimeStamper(fmt="iso")

    shared_processors: list[Any] = [
        structlog.contextvars.merge_contextvars,
        structlog.stdlib.add_log_level,
        structlog.stdlib.add_logger_name,
        timestamper,
        structlog.processors.StackInfoRenderer(),
    ]

    renderer: Any = (
        structlog.dev.ConsoleRenderer(colors=True)
        if env == "local"
        else structlog.processors.JSONRenderer()
    )

    # Hand structlog records to a stdlib handler so foreign (uvicorn/litellm/httpx)
    # and structlog logs render through the same formatter exactly once.
    structlog.configure(
        processors=[
            *shared_processors,
            structlog.stdlib.ProcessorFormatter.wrap_for_formatter,
        ],
        wrapper_class=structlog.stdlib.BoundLogger,
        context_class=dict,
        logger_factory=structlog.stdlib.LoggerFactory(),
        cache_logger_on_first_use=True,
    )

    # JSONRenderer needs format_exc_info first; ConsoleRenderer formats tracebacks itself.
    final_processors: list[Any] = [
        structlog.stdlib.ProcessorFormatter.remove_processors_meta,
    ]
    if env != "local":
        final_processors.append(structlog.processors.format_exc_info)
    final_processors.append(renderer)

    formatter = structlog.stdlib.ProcessorFormatter(
        foreign_pre_chain=shared_processors,
        processors=final_processors,
    )
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(formatter)

    root = logging.getLogger()
    root.handlers = [handler]
    root.setLevel(log_level)

    # Tame noisy libraries unless explicitly raised.
    for noisy in ("httpx", "httpcore", "urllib3", "asyncio"):
        logging.getLogger(noisy).setLevel(os.getenv(f"LOG_LEVEL_{noisy.upper()}", "WARNING"))
    # Uvicorn already adds an access log line per request; keep it but stop it from
    # double-formatting via its own handlers.
    for name in ("uvicorn", "uvicorn.error", "uvicorn.access"):
        lg = logging.getLogger(name)
        lg.handlers = []
        lg.propagate = True


def get_logger() -> structlog.stdlib.BoundLogger:
    log: structlog.stdlib.BoundLogger = structlog.get_logger()
    rid: str = request_id_var.get()
    if rid:
        log = log.bind(request_id=rid)
    return log


def generate_request_id() -> str:
    return uuid.uuid4().hex[:12]


log: structlog.stdlib.BoundLogger = get_logger()
