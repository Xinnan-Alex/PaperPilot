from __future__ import annotations

import voyageai

from paperpilot.config import settings
from paperpilot.logging import get_logger

_client: voyageai.Client | None = None
_log = get_logger().bind(component="embed")


def _get_client() -> voyageai.Client:
    global _client
    if _client is None:
        if not settings.voyage_api_key:
            _log.error("voyage_api_key_missing")
        _client = voyageai.Client(api_key=settings.voyage_api_key)
    return _client


def embed_documents(texts: list[str], batch_size: int = 128) -> list[list[float]]:
    client: voyageai.Client = _get_client()
    all_embeddings: list[list[float]] = []

    for i in range(0, len(texts), batch_size):
        batch: list[str] = texts[i : i + batch_size]
        try:
            result = client.embed(
                batch,
                model=settings.embedding_model,
                input_type="document",
            )
        except Exception:
            _log.exception(
                "voyage_embed_documents_failed",
                model=settings.embedding_model,
                batch_index=i // batch_size,
                batch_size=len(batch),
            )
            raise
        all_embeddings.extend(result.embeddings)

    return all_embeddings


def embed_query(text: str) -> list[float]:
    client: voyageai.Client = _get_client()
    try:
        result = client.embed(
            [text],
            model=settings.embedding_model,
            input_type="query",
        )
    except Exception:
        _log.exception(
            "voyage_embed_query_failed",
            model=settings.embedding_model,
            query_chars=len(text),
        )
        raise
    return result.embeddings[0]
