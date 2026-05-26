from typing import cast

import voyageai

from paperpilot.config import settings

_client: voyageai.Client | None = None


def _get_client() -> voyageai.Client:
    global _client
    if _client is None:
        _client = voyageai.Client(api_key=settings.voyage_api_key)
    return _client


def embed_documents(texts: list[str], batch_size: int = 128) -> list[list[float]]:
    client = _get_client()
    all_embeddings: list[list[float]] = []
    for i in range(0, len(texts), batch_size):
        batch = texts[i : i + batch_size]
        result = client.embed(
            batch,
            model=settings.embedding_model,
            input_type="document",
        )
        all_embeddings.extend(cast(list[list[float]], result.embeddings))

    return all_embeddings


def embed_query(text: str) -> list[float]:
    client = _get_client()
    result = client.embed([text], model=settings.embedding_model, input_type="query")
    return cast(list[float], result.embeddings[0])
