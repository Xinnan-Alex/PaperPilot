from __future__ import annotations

from collections.abc import AsyncIterator
from typing import Any

import litellm

from paperpilot.config import settings


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


async def stream_chat(
    messages: list[dict[str, Any]],
    model: str | None = None,
    temperature: float = 0.3,
    max_tokens: int = 1024,
) -> AsyncIterator[str]:
    """Yield text token strings from a chat completion.

    Wraps *stream_completion* and extracts the content delta from each chunk so
    callers receive plain strings rather than raw LiteLLM/OpenAI chunk objects.
    """
    resolved_model: str = model or settings.default_model_id
    async for chunk in stream_completion(
        resolved_model, messages, temperature=temperature, max_tokens=max_tokens
    ):
        delta = chunk.choices[0].delta if chunk.choices else None
        if delta and delta.content:
            yield delta.content
