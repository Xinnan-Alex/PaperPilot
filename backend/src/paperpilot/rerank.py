from __future__ import annotations

import voyageai

from paperpilot.config import settings
from paperpilot.logging import get_logger

_client: voyageai.Client | None = None
_log = get_logger().bind(component="rerank")


def _get_client() -> voyageai.Client:
    global _client
    if _client is None:
        _client = voyageai.Client(api_key=settings.voyage_api_key)
    return _client


def rerank_documents(
    query: str, documents: list[str], top_k: int
) -> list[tuple[int, float]]:
    """(original_index, relevance_score) pairs, best-first, length <= top_k.
    Falls back to identity order on disabled flag, empty input, or any error."""
    if not documents:
        return []
    identity: list[tuple[int, float]] = [
        (i, 0.0) for i in range(min(top_k, len(documents)))
    ]
    if not settings.enable_rerank:
        return identity
    try:
        result = _get_client().rerank(
            query, documents, model=settings.rerank_model, top_k=top_k
        )
        return [(r.index, float(r.relevance_score)) for r in result.results]
    except Exception as exc:
        _log.warning("rerank_failed", error=str(exc))
        return identity
