from __future__ import annotations

import json
from collections.abc import AsyncIterator
from typing import Any

from paperpilot import providers, tools
from paperpilot.llm import stream_completion

SYSTEM_PROMPT = (
    "You are PaperPilot, a research assistant. The user has uploaded documents; "
    "you have tools to search them, list them, summarize them, and (when enabled) "
    "search the web. Use tools when they would give a better answer than your priors. "
    "When you use search_documents, cite chunks in your reply with bracketed numbers "
    "like [1], [2] that match the order of returned chunks. Refuse off-topic or "
    "unsafe requests."
)


def _sse(event: str, data: Any) -> str:
    payload = data if isinstance(data, str) else json.dumps(data)
    return f"event: {event}\ndata: {payload}\n\n"


def _merge_tool_call_delta(buf: list[dict[str, Any]], delta_tcs: list[Any]) -> None:
    for d in delta_tcs:
        idx = getattr(d, "index", 0)
        while len(buf) <= idx:
            buf.append(
                {
                    "id": "",
                    "type": "function",
                    "function": {"name": "", "arguments": ""},
                }
            )
        slot = buf[idx]
        if getattr(d, "id", None):
            slot["id"] = d.id
        fn = getattr(d, "function", None)
        if fn is not None:
            if getattr(fn, "name", None):
                slot["function"]["name"] = fn.name
            if getattr(fn, "arguments", None):
                slot["function"]["arguments"] += fn.arguments


async def run(
    messages: list[dict[str, Any]],
    user_id: str,
    model_id: str,
    doc_ids: list[str] | None,
    access_token: str,
    db_session: Any,
    max_iterations: int = 5,
    allowed_tools: list[str] | None = None,
) -> AsyncIterator[str]:
    spec = providers.resolve(model_id)
    ctx = tools.ToolContext(
        user_id=user_id,
        access_token=access_token,
        doc_ids=doc_ids,
        db_session=db_session,
    )
    all_defs = tools.openai_tools()
    if allowed_tools is None:
        tool_defs = all_defs
    else:
        allowed_set = set(allowed_tools)
        tool_defs = [t for t in all_defs if t["function"]["name"] in allowed_set]
    convo: list[dict[str, Any]] = [{"role": "system", "content": SYSTEM_PROMPT}, *messages]
    aggregated_sources: list[dict[str, Any]] = []

    for _ in range(max_iterations):
        accumulated_tool_calls: list[dict[str, Any]] = []
        assistant_text = ""

        async for chunk in stream_completion(
            model=spec.litellm_id,
            messages=convo,
            tools=tool_defs or None,
        ):
            choice = chunk.choices[0] if chunk.choices else None
            if choice is None:
                continue
            d = choice.delta
            if getattr(d, "content", None):
                assistant_text += d.content
                yield _sse("token", d.content)
            tcs = getattr(d, "tool_calls", None)
            if tcs:
                _merge_tool_call_delta(accumulated_tool_calls, tcs)

        if not accumulated_tool_calls:
            if aggregated_sources:
                yield _sse("sources", aggregated_sources)
            yield _sse("done", "")
            return

        convo.append(
            {
                "role": "assistant",
                "content": assistant_text or None,
                "tool_calls": accumulated_tool_calls,
            }
        )

        for tc in accumulated_tool_calls:
            try:
                args = json.loads(tc["function"]["arguments"] or "{}")
            except json.JSONDecodeError:
                args = {}
            name = tc["function"]["name"]
            yield _sse("tool_call", {"id": tc["id"], "name": name, "args": args})

            result = await tools.dispatch(name, args, ctx)
            yield _sse("tool_result", {"id": tc["id"], "result": result})

            if name == "search_documents" and isinstance(result, dict):
                chunks = result.get("chunks") or []
                aggregated_sources.extend(chunks)

            convo.append(
                {
                    "role": "tool",
                    "tool_call_id": tc["id"],
                    "content": json.dumps(result),
                }
            )

    yield _sse("token", "[stopped: max tool iterations reached]")
    if aggregated_sources:
        yield _sse("sources", aggregated_sources)
    yield _sse("done", "")
