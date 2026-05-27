from __future__ import annotations

import json
from collections.abc import AsyncIterator
from typing import Any

from paperpilot.db import get_db
from paperpilot.embed import embed_query
from paperpilot.llm import stream_chat
from paperpilot.retrieve import hybrid_search


SYSTEM_PROMPT: str = """You are a helpful research assistant answering questions about the user's documents.

Rules:
1. Answer ONLY using the provided context sections below. If the context does not contain enough information to answer, say "I don't know based on the provided documents."
2. Cite your sources using bracketed numbers like [1], [2] that correspond to the numbered context sections.
3. Be concise but thorough. Prefer direct quotes when possible.
4. If multiple context sections are relevant, synthesize them into a single coherent answer."""


def _build_prompt(query: str, chunks: list[dict[str, Any]]) -> list[dict[str, str]]:
    context_parts: list[str] = []
    for i, chunk in enumerate(chunks):
        filename: str = chunk.get("filename", "unknown")
        page: Any = chunk.get("page", "N/A")
        context_parts.append(f"[{i + 1}] (File: {filename}, Page: {page})\n{chunk['text']}")

    context: str = "\n\n".join(context_parts)

    user_message: str = f"""Context sections:

{context}

Question: {query}"""

    return [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": user_message},
    ]


async def answer(
    query: str,
    user_id: str,
    top_k: int = 5,
    doc_ids: list[str] | None = None,
) -> AsyncIterator[str]:
    query_embedding: list[float] = embed_query(query)

    chunks: list[dict[str, Any]] = []
    async for session in get_db():
        chunks = await hybrid_search(
            session, user_id, query, query_embedding, k=top_k, doc_ids=doc_ids
        )

    if not chunks:
        yield "event: token\ndata: I couldn't find any relevant documents to answer your question.\n\n"
        yield "event: sources\ndata: []\n\n"
        yield "event: done\ndata: \n\n"
        return

    messages: list[dict[str, str]] = _build_prompt(query, chunks)
    response_text: str = ""

    async for token in stream_chat(messages):
        response_text += token
        yield f"event: token\ndata: {json.dumps(token)}\n\n"

    sources_data: list[dict[str, Any]] = []
    for chunk in chunks:
        chunk_id: str = str(chunk.get("id", ""))
        sources_data.append(
            {
                "chunk_id": chunk_id,
                "ordinal": chunk.get("ordinal", 0),
                "page": chunk.get("page"),
                "text": chunk.get("text", ""),
                "document_filename": chunk.get("filename", "unknown"),
            }
        )

    yield f"event: sources\ndata: {json.dumps(sources_data)}\n\n"
    yield "event: done\ndata: \n\n"
