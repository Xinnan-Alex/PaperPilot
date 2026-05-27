from __future__ import annotations

from collections.abc import AsyncIterator

from openai import AsyncOpenAI

from paperpilot.config import settings

client: AsyncOpenAI = AsyncOpenAI(
    api_key=settings.deepseek_api_key,
    base_url=settings.llm_base_url,
)


async def stream_chat(
    messages: list[dict[str, str]],
    temperature: float = 0.3,
    max_tokens: int = 1024,
) -> AsyncIterator[str]:
    response = await client.chat.completions.create(
        model=settings.llm_model,
        messages=messages,  # type: ignore[arg-type]
        temperature=temperature,
        max_tokens=max_tokens,
        stream=True,
    )
    async for chunk in response:
        if chunk.choices and chunk.choices[0].delta.content:
            yield chunk.choices[0].delta.content
