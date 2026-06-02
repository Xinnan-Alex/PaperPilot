from __future__ import annotations

from collections.abc import AsyncIterator
from typing import Any

import litellm


async def stream_completion(
    model: str,
    messages: list[dict[str, Any]],
    tools: list[dict[str, Any]] | None = None,
    temperature: float = 0.3,
    max_tokens: int = 1024,
    tool_choice: str = "auto",
) -> AsyncIterator[Any]:
    """Provider-agnostic streaming completion via LiteLLM.

    Yields raw chunks; the caller is responsible for handling token deltas and
    tool-call deltas. The chunk shape matches the OpenAI streaming format
    regardless of underlying provider.
    """
    kwargs: dict[str, Any] = {
        "model": model,
        "messages": messages,
        "temperature": temperature,
        "max_tokens": max_tokens,
        "stream": True,
    }
    if tools:
        kwargs["tools"] = tools
        kwargs["tool_choice"] = tool_choice

    response = await litellm.acompletion(**kwargs)
    try:
        async for chunk in response:
            yield chunk
    except ValueError as exc:
        # litellm bug: MidStreamFallbackError.__init__ does int(status) where
        # status can be a non-numeric string like 'tool_use_failed' (Groq returns
        # this when the model emits a malformed tool call). End the stream
        # cleanly so the agent's empty-turn retry can recover.
        if "tool_use_failed" in str(exc):
            return
        raise litellm.InternalServerError(
            message=f"Stream error: {exc}",
            llm_provider="litellm",
            model=model,
        ) from exc
