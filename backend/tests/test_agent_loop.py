from __future__ import annotations

import json
from collections.abc import AsyncIterator
from typing import Any

import pytest

from paperpilot import agent, tools


def _delta(content: str | None = None, tool_calls: list[dict[str, Any]] | None = None) -> Any:
    class D:
        def __init__(self) -> None:
            self.content = content
            self.tool_calls = tool_calls

    class Choice:
        def __init__(self) -> None:
            self.delta = D()
            self.finish_reason = None

    class Chunk:
        def __init__(self) -> None:
            self.choices = [Choice()]

    return Chunk()


def _tool_call_delta(idx: int, call_id: str, name: str, arg_fragment: str) -> dict[str, Any]:
    class F:
        def __init__(self) -> None:
            self.name = name
            self.arguments = arg_fragment

    class TC:
        def __init__(self) -> None:
            self.index = idx
            self.id = call_id
            self.type = "function"
            self.function = F()

    return TC()


@pytest.fixture(autouse=True)
def isolate_registry(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(tools, "REGISTRY", {})


async def test_agent_no_tool_calls_streams_tokens(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("DEEPSEEK_API_KEY", "x")
    monkeypatch.setattr(tools, "REGISTRY", {})

    async def fake_stream(**kwargs: Any) -> AsyncIterator[Any]:
        yield _delta(content="Hello")
        yield _delta(content=" world")

    monkeypatch.setattr(agent, "stream_completion", fake_stream)

    events: list[str] = []
    async for raw in agent.run(
        messages=[{"role": "user", "content": "hi"}],
        user_id="u",
        model_id="deepseek-chat",
        doc_ids=None,
        access_token="t",
        db_session=object(),
        max_iterations=3,
    ):
        events.append(raw)

    joined = "".join(events)
    assert "event: token" in joined
    assert "Hello" in joined
    assert " world" in joined
    assert "event: done" in joined


async def test_agent_runs_one_tool_then_terminates(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("DEEPSEEK_API_KEY", "x")

    called: list[dict[str, Any]] = []

    async def echo_handler(args: dict[str, Any], ctx: tools.ToolContext) -> dict[str, Any]:
        called.append(args)
        return {"ok": True}

    tools.register(
        tools.ToolSpec(
            name="echo",
            description="echoes",
            parameters={"type": "object", "properties": {}},
            handler=echo_handler,
        )
    )

    iteration = 0

    async def fake_stream(**kwargs: Any) -> AsyncIterator[Any]:
        nonlocal iteration
        iteration += 1
        if iteration == 1:
            yield _delta(tool_calls=[_tool_call_delta(0, "c1", "echo", '{"a":1}')])
        else:
            yield _delta(content="final answer")

    monkeypatch.setattr(agent, "stream_completion", fake_stream)

    events: list[str] = []
    async for raw in agent.run(
        messages=[{"role": "user", "content": "hi"}],
        user_id="u",
        model_id="deepseek-chat",
        doc_ids=None,
        access_token="t",
        db_session=object(),
        max_iterations=3,
    ):
        events.append(raw)

    joined = "".join(events)
    assert called == [{"a": 1}]
    assert "event: tool_call" in joined
    assert "event: tool_result" in joined
    assert "final answer" in joined
    assert "event: done" in joined


async def test_agent_enforces_max_iterations(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("DEEPSEEK_API_KEY", "x")

    async def loop_handler(args: dict[str, Any], ctx: tools.ToolContext) -> dict[str, Any]:
        return {"again": True}

    tools.register(
        tools.ToolSpec(
            name="loop",
            description="loops",
            parameters={"type": "object", "properties": {}},
            handler=loop_handler,
        )
    )

    async def fake_stream(**kwargs: Any) -> AsyncIterator[Any]:
        yield _delta(tool_calls=[_tool_call_delta(0, "c1", "loop", "{}")])

    monkeypatch.setattr(agent, "stream_completion", fake_stream)

    events: list[str] = []
    async for raw in agent.run(
        messages=[{"role": "user", "content": "hi"}],
        user_id="u",
        model_id="deepseek-chat",
        doc_ids=None,
        access_token="t",
        db_session=object(),
        max_iterations=2,
    ):
        events.append(raw)

    joined = "".join(events)
    assert "max tool iterations reached" in joined
    assert "event: done" in joined


async def test_agent_respects_allowed_tools(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("DEEPSEEK_API_KEY", "x")

    async def _h(args: dict[str, Any], ctx: tools.ToolContext) -> dict[str, Any]:
        return {}

    tools.register(
        tools.ToolSpec(
            name="a", description="", parameters={"type": "object", "properties": {}}, handler=_h
        )
    )
    tools.register(
        tools.ToolSpec(
            name="b", description="", parameters={"type": "object", "properties": {}}, handler=_h
        )
    )

    captured_tools: list[list[dict[str, Any]]] = []

    async def fake_stream(**kwargs: Any) -> AsyncIterator[Any]:
        captured_tools.append(kwargs.get("tools") or [])
        yield _delta(content="done")

    monkeypatch.setattr(agent, "stream_completion", fake_stream)

    async for _ in agent.run(
        messages=[{"role": "user", "content": "hi"}],
        user_id="u",
        model_id="deepseek-chat",
        doc_ids=None,
        access_token="t",
        db_session=object(),
        max_iterations=1,
        allowed_tools=["a"],
    ):
        pass

    names = {t["function"]["name"] for t in captured_tools[0]}
    assert names == {"a"}


async def test_agent_emits_sources_from_search_documents(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("DEEPSEEK_API_KEY", "x")

    async def search_handler(args: dict[str, Any], ctx: tools.ToolContext) -> dict[str, Any]:
        return {
            "chunks": [
                {
                    "chunk_id": "c-1",
                    "document_id": "d-1",
                    "ordinal": 0,
                    "page": 3,
                    "text": "t",
                    "filename": "p.pdf",
                }
            ]
        }

    tools.register(
        tools.ToolSpec(
            name="search_documents",
            description="search",
            parameters={"type": "object", "properties": {}},
            handler=search_handler,
        )
    )

    iteration = 0

    async def fake_stream(**kwargs: Any) -> AsyncIterator[Any]:
        nonlocal iteration
        iteration += 1
        if iteration == 1:
            yield _delta(
                tool_calls=[_tool_call_delta(0, "c1", "search_documents", '{"query":"x"}')]
            )
        else:
            yield _delta(content="answer")

    monkeypatch.setattr(agent, "stream_completion", fake_stream)

    events: list[str] = []
    async for raw in agent.run(
        messages=[{"role": "user", "content": "hi"}],
        user_id="u",
        model_id="deepseek-chat",
        doc_ids=None,
        access_token="t",
        db_session=object(),
        max_iterations=3,
    ):
        events.append(raw)

    joined = "".join(events)
    assert "event: sources" in joined
    assert "c-1" in joined
