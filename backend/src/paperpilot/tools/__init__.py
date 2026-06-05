from __future__ import annotations

from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any, TypedDict

from paperpilot.logging import get_logger

logger = get_logger().bind(component="tools")

ToolHandler = Callable[[dict[str, Any], "ToolContext"], Awaitable[dict[str, Any]]]


class ToolSpec(TypedDict):
    name: str
    description: str
    parameters: dict[str, Any]
    handler: ToolHandler


@dataclass
class ToolContext:
    user_id: str
    access_token: str
    doc_ids: list[str] | None
    db_session: Any  # AsyncSession at runtime; Any to avoid import cycle in tests
    model: Any = None  # resolved ModelSpec; Any to avoid import cycle


REGISTRY: dict[str, ToolSpec] = {}


def register(spec: ToolSpec) -> None:
    REGISTRY[spec["name"]] = spec


def openai_tools() -> list[dict[str, Any]]:
    return [
        {
            "type": "function",
            "function": {
                "name": s["name"],
                "description": s["description"],
                "parameters": s["parameters"],
            },
        }
        for s in REGISTRY.values()
    ]


async def dispatch(name: str, args: dict[str, Any], ctx: ToolContext) -> dict[str, Any]:
    spec = REGISTRY.get(name)
    if spec is None:
        logger.warning("tool_unknown", tool=name, user_id=ctx.user_id)
        return {"error": f"unknown tool: {name}"}
    try:
        return await spec["handler"](args, ctx)
    except Exception as exc:  # tool failures must never escape the agent loop
        logger.exception(
            "tool_handler_failed",
            tool=name,
            user_id=ctx.user_id,
            args=args,
            exc_type=type(exc).__name__,
        )
        return {"error": f"{type(exc).__name__}: {exc}"}
