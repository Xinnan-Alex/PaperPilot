import uuid
from contextvars import ContextVar

import structlog

request_id_var: ContextVar[str] = ContextVar("requst_id", default="")


def configure_logging(env: str = "local"):
    structlog.configure(
        processors=[
            structlog.contextvars.merge_contextvars,
            structlog.stdlib.filter_by_level,
            structlog.stdlib.add_log_level,
            structlog.processors.TimeStamper(fmt="iso"),
            structlog.dev.ConsoleRenderer()
            if env == "local"
            else structlog.processors.JSONRenderer(),
        ],
        wrapper_class=structlog.stdlib.BoundLogger,
        context_class=dict,
        logger_factory=structlog.stdlib.LoggerFactory(),
        cache_logger_on_first_use=True,
    )


def get_logger() -> structlog.stdlib.BoundLogger:
    log = structlog.get_logger()
    rid = request_id_var.get()
    if rid:
        log = log.bind(request_id=rid)
    return log


def generate_request_id() -> str:
    return uuid.uuid4().hex[:12]


log = get_logger()
