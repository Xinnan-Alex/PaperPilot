from __future__ import annotations

from collections.abc import AsyncIterator

from paperpilot import agent, providers
from paperpilot.config import settings
from paperpilot.db import get_db


async def answer(
    query: str,
    user_id: str,
    top_k: int = 5,
    doc_ids: list[str] | None = None,
) -> AsyncIterator[str]:
    """Backward-compatible /query path.

    Routes through the agent loop with a single tool (search_documents) and
    a single iteration so behavior matches the pre-agentic flow.
    """
    try:
        spec = providers.resolve(settings.default_model_id)
    except Exception:
        available = providers.available_models()
        if not available:
            yield "event: token\ndata: \"No LLM providers configured.\"\n\n"
            yield "event: done\ndata: \n\n"
            return
        spec = available[0]

    async for session in get_db():
        async for evt in agent.run(
            messages=[{"role": "user", "content": query}],
            user_id=user_id,
            model_id=spec.id,
            doc_ids=doc_ids,
            access_token="",
            db_session=session,
            max_iterations=1,
            allowed_tools=["search_documents"],
        ):
            yield evt
