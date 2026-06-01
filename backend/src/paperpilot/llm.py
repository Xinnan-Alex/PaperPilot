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
        kwargs["tool_choice"] = "auto"

    response = await litellm.acompletion(**kwargs)
    async for chunk in response:
        yield chunk
