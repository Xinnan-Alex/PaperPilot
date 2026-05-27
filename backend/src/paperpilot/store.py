from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from paperpilot.models import Chunk


async def insert_document(
    session: AsyncSession,
    user_id: str,
    filename: str,
    storage_path: str,
) -> str:
    doc_id: str = str(uuid.uuid4())
    stmt = text("""
        INSERT INTO documents (id, user_id, filename, storage_path, status, created_at)
        VALUES (:id, :user_id, :filename, :storage_path, 'pending', :now)
    """)
    await session.execute(
        stmt,
        {
            "id": doc_id,
            "user_id": user_id,
            "filename": filename,
            "storage_path": storage_path,
            "now": datetime.utcnow(),
        },
    )
    await session.commit()
    return doc_id


async def insert_chunks(
    session: AsyncSession,
    user_id: str,
    document_id: str,
    chunks: list[Chunk],
    batch_size: int = 100,
) -> None:
    for i in range(0, len(chunks), batch_size):
        batch: list[Chunk] = chunks[i:i + batch_size]
        for chunk in batch:
            chunk_id: str = str(uuid.uuid4())
            embedding_str: str | None = f"[{','.join(str(v) for v in chunk.embedding)}]" if chunk.embedding else None
            stmt = text("""
                INSERT INTO chunks (id, document_id, user_id, ordinal, page, text, embedding)
                VALUES (:id, :document_id, :user_id, :ordinal, :page, :text, CAST(:embedding AS vector))
            """)
            await session.execute(
                stmt,
                {
                    "id": chunk_id,
                    "document_id": document_id,
                    "user_id": user_id,
                    "ordinal": chunk.ordinal,
                    "page": chunk.page,
                    "text": chunk.text,
                    "embedding": embedding_str,
                },
            )
        await session.commit()


async def update_document_status(
    session: AsyncSession,
    document_id: str,
    status: str,
) -> None:
    stmt = text("UPDATE documents SET status = :status WHERE id = :id")
    await session.execute(stmt, {"status": status, "id": document_id})
    await session.commit()


async def search_vectors(
    session: AsyncSession,
    user_id: str,
    query_embedding: list[float],
    k: int = 5,
    doc_ids: list[str] | None = None,
) -> list[dict[str, Any]]:
    embedding_str: str = f"[{','.join(str(v) for v in query_embedding)}]"

    if doc_ids and len(doc_ids) > 0:
        stmt = text("""
            SELECT c.id, c.ordinal, c.page, c.text,
                   c.embedding <=> CAST(:embedding AS vector) AS distance,
                   d.filename
            FROM chunks c
            JOIN documents d ON c.document_id = d.id
            WHERE c.user_id = :user_id
              AND c.document_id = ANY(CAST(:doc_ids AS uuid[]))
            ORDER BY c.embedding <=> CAST(:embedding AS vector)
            LIMIT :k
        """)
        result = await session.execute(
            stmt,
            {"user_id": user_id, "embedding": embedding_str, "doc_ids": doc_ids, "k": k},
        )
    else:
        stmt = text("""
            SELECT c.id, c.ordinal, c.page, c.text,
                   c.embedding <=> CAST(:embedding AS vector) AS distance,
                   d.filename
            FROM chunks c
            JOIN documents d ON c.document_id = d.id
            WHERE c.user_id = :user_id
            ORDER BY c.embedding <=> CAST(:embedding AS vector)
            LIMIT :k
        """)
        result = await session.execute(
            stmt, {"user_id": user_id, "embedding": embedding_str, "k": k}
        )

    rows = result.fetchall()
    return [dict(row._mapping) for row in rows]


async def list_documents(
    session: AsyncSession,
    user_id: str,
) -> list[dict[str, Any]]:
    stmt = text("""
        SELECT id, filename, status, created_at
        FROM documents
        WHERE user_id = :user_id
        ORDER BY created_at DESC
    """)
    result = await session.execute(stmt, {"user_id": user_id})
    return [dict(row._mapping) for row in result.fetchall()]