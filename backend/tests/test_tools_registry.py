from __future__ import annotations

from typing import Any

import pytest

from paperpilot import tools


@pytest.fixture(autouse=True)
def isolate_registry(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(tools, "REGISTRY", {})


async def _echo(args: dict[str, Any], ctx: tools.ToolContext) -> dict[str, Any]:
    return {"echo": args}


def test_register_and_openai_tools() -> None:
    tools.register(
        tools.ToolSpec(
            name="echo",
            description="echoes",
            parameters={"type": "object", "properties": {"x": {"type": "string"}}},
            handler=_echo,
        )
    )
    defs = tools.openai_tools()
    assert len(defs) == 1
    assert defs[0]["type"] == "function"
    assert defs[0]["function"]["name"] == "echo"
    assert defs[0]["function"]["description"] == "echoes"
    assert defs[0]["function"]["parameters"]["type"] == "object"


async def test_dispatch_runs_handler() -> None:
    tools.register(
        tools.ToolSpec(
            name="echo",
            description="echoes",
            parameters={"type": "object", "properties": {}},
            handler=_echo,
        )
    )
    ctx = tools.ToolContext(user_id="u", access_token="t", doc_ids=None, db_session=None)
    result = await tools.dispatch("echo", {"hello": "world"}, ctx)
    assert result == {"echo": {"hello": "world"}}


async def test_dispatch_unknown_tool_returns_error() -> None:
    ctx = tools.ToolContext(user_id="u", access_token="t", doc_ids=None, db_session=None)
    result = await tools.dispatch("nope", {}, ctx)
    assert "error" in result
    assert "unknown tool" in result["error"].lower()


async def test_dispatch_handler_exception_returns_error() -> None:
    async def boom(args: dict[str, Any], ctx: tools.ToolContext) -> dict[str, Any]:
        raise RuntimeError("kapow")

    tools.register(
        tools.ToolSpec(
            name="bad",
            description="bad",
            parameters={"type": "object", "properties": {}},
            handler=boom,
        )
    )
    ctx = tools.ToolContext(user_id="u", access_token="t", doc_ids=None, db_session=None)
    result = await tools.dispatch("bad", {}, ctx)
    assert "error" in result
    assert "kapow" in result["error"]
