"""Regression tests for tenant isolation in store.py.

Every read/write/delete that touches documents or chunks must be scoped by
user_id so that a future refactor cannot silently expose one user's data to
another. Each test captures the raw SQL string and bound parameters passed to
the async session and asserts that the correct WHERE clauses and param bindings
are present.
"""

from __future__ import annotations

from typing import Any, cast

from sqlalchemy.ext.asyncio import AsyncSession

from paperpilot.models import Chunk
from paperpilot.store import (
    delete_document,
    get_document,
    insert_chunks,
    list_documents,
    search_vectors,
)

# ---------------------------------------------------------------------------
# Test doubles
# ---------------------------------------------------------------------------


class FakeResult:
    """Minimal stand-in for an SQLAlchemy CursorResult."""

    def __init__(self, rows: list[dict[str, Any]]) -> None:
        self._rows = rows

    def fetchall(self) -> list[Any]:
        class Row:
            def __init__(self, values: dict[str, Any]) -> None:
                self._mapping = values

        return [Row(r) for r in self._rows]

    def fetchone(self) -> Any | None:
        if not self._rows:
            return None

        class Row:
            def __init__(self, values: dict[str, Any]) -> None:
                self._mapping = values
                # Support index-based access (row[0]) used in delete_document.
                self._vals = list(values.values())

            def __getitem__(self, idx: int) -> Any:
                return self._vals[idx]

        return Row(self._rows[0])


class FakeSession:
    """Records every (sql_string, params) pair from execute() calls.

    delete_document() makes three execute() calls (SELECT, DELETE chunks,
    DELETE documents). The first call must return a row with a storage_path so
    the function proceeds past the early-return guard.
    """

    def __init__(self, initial_rows: list[dict[str, Any]] | None = None) -> None:
        self.calls: list[tuple[str, dict[str, Any]]] = []
        self._initial_rows = initial_rows or []

    async def execute(self, stmt: Any, params: dict[str, Any] | None = None) -> FakeResult:
        sql = str(stmt)
        bound: dict[str, Any] = params or {}
        self.calls.append((sql, bound))
        # Return the seeded rows for the first call; empty thereafter.
        if len(self.calls) == 1:
            return FakeResult(self._initial_rows)
        return FakeResult([])

    async def commit(self) -> None:
        pass

    # Convenience helpers for single-call tests.
    @property
    def sql(self) -> str:
        return self.calls[-1][0] if self.calls else ""

    @property
    def params(self) -> dict[str, Any]:
        return self.calls[-1][1] if self.calls else {}


# ---------------------------------------------------------------------------
# search_vectors
# ---------------------------------------------------------------------------


async def test_search_vectors_filters_by_user_id() -> None:
    session = FakeSession(
        initial_rows=[
            {
                "id": "c-1",
                "document_id": "d-1",
                "ordinal": 0,
                "page": 1,
                "text": "hello",
                "distance": 0.1,
                "filename": "doc.pdf",
                "storage_path": "u/doc.pdf",
            }
        ]
    )

    rows = await search_vectors(
        cast(AsyncSession, session),
        user_id="u-1",
        query_embedding=[0.1, 0.2, 0.3],
        k=5,
    )

    assert rows[0]["id"] == "c-1"
    assert "c.user_id = :user_id" in session.sql
    assert session.params["user_id"] == "u-1"
    # No doc_ids filter in the no-filter path.
    assert "document_id = ANY" not in session.sql


async def test_search_vectors_with_doc_ids_filters_both_user_and_doc() -> None:
    session = FakeSession(
        initial_rows=[
            {
                "id": "c-2",
                "document_id": "d-2",
                "ordinal": 0,
                "page": 1,
                "text": "world",
                "distance": 0.2,
                "filename": "doc2.pdf",
                "storage_path": "u/doc2.pdf",
            }
        ]
    )

    doc_ids = ["d-2", "d-3"]
    rows = await search_vectors(
        cast(AsyncSession, session),
        user_id="u-1",
        query_embedding=[0.1, 0.2, 0.3],
        k=5,
        doc_ids=doc_ids,
    )

    assert rows[0]["id"] == "c-2"
    assert "c.user_id = :user_id" in session.sql
    assert "c.document_id = ANY(CAST(:doc_ids AS uuid[]))" in session.sql
    assert session.params["user_id"] == "u-1"
    assert session.params["doc_ids"] == doc_ids


# ---------------------------------------------------------------------------
# list_documents
# ---------------------------------------------------------------------------


async def test_list_documents_filters_by_user_id() -> None:
    session = FakeSession(
        initial_rows=[
            {
                "id": "d-1",
                "filename": "paper.pdf",
                "status": "ready",
                "stage": None,
                "error_detail": None,
                "retry_count": 0,
                "created_at": None,
            }
        ]
    )

    docs = await list_documents(cast(AsyncSession, session), user_id="u-1")

    assert docs[0]["id"] == "d-1"
    assert "WHERE user_id = :user_id" in session.sql
    assert session.params["user_id"] == "u-1"


# ---------------------------------------------------------------------------
# get_document
# ---------------------------------------------------------------------------


async def test_get_document_filters_by_both_doc_id_and_user_id() -> None:
    session = FakeSession(
        initial_rows=[
            {
                "id": "d-1",
                "filename": "paper.pdf",
                "status": "ready",
                "stage": None,
                "error_detail": None,
                "retry_count": 0,
                "created_at": None,
            }
        ]
    )

    doc = await get_document(cast(AsyncSession, session), user_id="u-1", doc_id="d-1")

    assert doc is not None
    assert doc["id"] == "d-1"
    assert "id = :doc_id" in session.sql
    assert "user_id = :user_id" in session.sql
    assert session.params["doc_id"] == "d-1"
    assert session.params["user_id"] == "u-1"


# ---------------------------------------------------------------------------
# delete_document
# ---------------------------------------------------------------------------


async def test_delete_document_all_queries_scoped_by_user_id() -> None:
    # Seed the first call (SELECT storage_path) so delete_document proceeds.
    session = FakeSession(initial_rows=[{"storage_path": "u/paper.pdf"}])

    path = await delete_document(cast(AsyncSession, session), user_id="u-1", doc_id="d-1")

    assert path == "u/paper.pdf"
    # Three execute calls: SELECT, DELETE chunks, DELETE documents.
    assert len(session.calls) == 3

    select_sql, select_params = session.calls[0]
    assert "user_id = :user_id" in select_sql
    assert select_params["user_id"] == "u-1"

    # DELETE chunks must be scoped to the (already ownership-verified) document
    # — never an unscoped/global delete.
    delete_chunks_sql, delete_chunks_params = session.calls[1]
    assert "DELETE FROM chunks" in delete_chunks_sql
    assert "document_id = :id" in delete_chunks_sql
    assert delete_chunks_params["id"] == "d-1"

    # DELETE documents also must be scoped by user_id.
    delete_doc_sql, delete_doc_params = session.calls[2]
    assert "user_id = :user_id" in delete_doc_sql
    assert delete_doc_params["user_id"] == "u-1"


# ---------------------------------------------------------------------------
# insert_chunks
# ---------------------------------------------------------------------------


async def test_insert_chunks_binds_user_id_on_each_chunk() -> None:
    session = FakeSession()

    chunk = Chunk(ordinal=0, page=1, text="sample text", embedding=[0.1] * 512)

    await insert_chunks(
        cast(AsyncSession, session),
        user_id="u-1",
        document_id="d-1",
        chunks=[chunk],
    )

    # At least one execute call must have been made for the chunk INSERT.
    assert len(session.calls) >= 1
    insert_sql, insert_params = session.calls[0]
    assert ":user_id" in insert_sql
    assert insert_params["user_id"] == "u-1"
    assert insert_params["document_id"] == "d-1"
    assert insert_params["ordinal"] == 0
