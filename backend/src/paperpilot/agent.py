from __future__ import annotations

import json
from collections.abc import AsyncIterator
from typing import Any

from paperpilot import providers, tools
from paperpilot.llm import stream_completion
from paperpilot.store import list_documents as _list_user_documents

_DOC_TOOL_NAMES: frozenset[str] = frozenset(
    {"search_documents", "list_documents", "get_document_summary"}
)
_RETRY_SEQUENCE: tuple[str, ...] = ("auto", "required", "none")

_BASE_SYSTEM_PROMPT = (
    "You are PaperPilot, a research assistant. The user has uploaded documents; "
    "you have tools to search them, list them, summarize them, and (when enabled) "
    "search the web. "
    "IMPORTANT: You MUST call tools directly — never describe or narrate that you are "
    "going to call a tool. If you need to search, call the tool immediately without "
    "preamble. "
    "When you use search_documents, cite chunks in your reply with bracketed numbers "
    "like [1], [2] that match the order of returned chunks. Refuse off-topic or "
    "unsafe requests.\n\n"
    "OUTPUT FORMAT (mandatory — do not deviate):\n"
    "Use ONLY this restricted Markdown subset:\n"
    "  - Paragraphs separated by a blank line.\n"
    "  - Inline bold via **bold** for emphasis or short section labels (one paragraph each).\n"
    "  - Unordered lists using '- item' (one item per line: hyphen, space, content).\n"
    "  - Ordered lists using '1. item' (one item per line).\n"
    "  - Inline code with backticks; fenced code blocks with triple backticks.\n"
    "  - Citations as [1], [2] inline (search_documents only).\n\n"
    "FORBIDDEN — never emit:\n"
    "  - ATX headings (#, ##, ###, ...). Use **Bold Section Label** on its own paragraph instead.\n"
    "  - Horizontal rules (---).\n"
    "  - Italic (*text* or _text_).\n"
    "  - HTML tags.\n\n"
    "Every block element (paragraph, list, code block) MUST be separated from the next "
    "by a blank line. Never concatenate body content onto the same line as a bold section label."
)


def _build_system_prompt(doc_ids: list[str] | None) -> str:
    if doc_ids:
        ids = ", ".join(doc_ids)
        return (
            _BASE_SYSTEM_PROMPT
            + f" The user has narrowed the context to these document IDs: [{ids}]. "
            "Only answer from those documents — do not list or summarise other documents."
        )
    return (
        _BASE_SYSTEM_PROMPT
        + " If you find many documents and cannot determine which are relevant, "
        "suggest the user select specific documents via the document picker."
    )


def _sse(event: str, data: Any) -> str:
    payload = json.dumps(data)
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

    user_docs = await _list_user_documents(db_session, user_id)
    has_ready_docs = any(d.get("status") == "ready" for d in user_docs)
    if not has_ready_docs:
        tool_defs = [t for t in tool_defs if t["function"]["name"] not in _DOC_TOOL_NAMES]

    convo: list[dict[str, Any]] = [{"role": "system", "content": _build_system_prompt(doc_ids)}, *messages]
    aggregated_sources: list[dict[str, Any]] = []
    retry_stage = 0

    for _ in range(max_iterations):
        accumulated_tool_calls: list[dict[str, Any]] = []
        assistant_text = ""
        tool_choice = _RETRY_SEQUENCE[min(retry_stage, len(_RETRY_SEQUENCE) - 1)]
        temperature = 0.0 if tool_defs else 0.3

        try:
            async for chunk in stream_completion(
                model=spec.litellm_id,
                messages=convo,
                tools=tool_defs or None,
                tool_choice=tool_choice,
                temperature=temperature,
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
        except Exception as exc:
            yield _sse("token", f"\n\n[Error: {exc}]")
            yield _sse("done", "")
            return

        if not accumulated_tool_calls and not assistant_text:
            retry_stage += 1
            if retry_stage >= len(_RETRY_SEQUENCE):
                yield _sse(
                    "token",
                    "[Model returned an empty response. Try rephrasing your question.]",
                )
                yield _sse("done", "")
                return
            next_choice = _RETRY_SEQUENCE[retry_stage]
            if next_choice == "required":
                nudge = (
                    "Your previous turn was empty. Call exactly one tool to gather "
                    "the information needed to answer the user's last message."
                )
            else:
                nudge = (
                    "Your previous turn was empty. Respond directly to the user's "
                    "last message in plain text without calling any tool."
                )
            convo.append({"role": "system", "content": nudge})
            continue

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
