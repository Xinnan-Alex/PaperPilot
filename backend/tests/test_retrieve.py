from __future__ import annotations

from typing import Any, cast

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from paperpilot.retrieve import keyword_search


class FakeResult:
    def __init__(self, rows: list[dict[str, Any]]) -> None:
        self._rows = rows

    def fetchall(self) -> list[Any]:
        class Row:
            def __init__(self, values: dict[str, Any]) -> None:
                self._mapping = values

        return [Row(row) for row in self._rows]


class FakeSession:
    def __init__(self) -> None:
        self.sql = ""
        self.params: dict[str, Any] = {}

    async def execute(self, stmt: Any, params: dict[str, Any]) -> FakeResult:
        self.sql = str(stmt)
        self.params = params
        return FakeResult(
            [
                {
                    "id": "c-1",
                    "document_id": "d-1",
                    "ordinal": 0,
                    "page": 2,
                    "text": "postgres full text search",
                    "filename": "paper.pdf",
                    "storage_path": "u/paper.pdf",
                    "keyword_score": 0.42,
                }
            ]
        )


@pytest.mark.parametrize(
    ("doc_ids", "expected_filter"),
    [(None, False), (["d-1", "d-2"], True)],
)
async def test_keyword_search_uses_postgres_full_text_search(
    doc_ids: list[str] | None, expected_filter: bool
) -> None:
    session = FakeSession()

    rows = await keyword_search(
        cast(AsyncSession, session), "u-1", "full text", k=7, doc_ids=doc_ids
    )

    assert rows[0]["id"] == "c-1"
    assert "websearch_to_tsquery" in session.sql
    assert "ts_rank_cd" in session.sql
    assert "search_vector @@ q.query" in session.sql
    assert "c.user_id = :user_id" in session.sql
    assert ("c.document_id = ANY(CAST(:doc_ids AS uuid[]))" in session.sql) is expected_filter
    assert session.params["user_id"] == "u-1"
    assert session.params["query"] == "full text"
    assert session.params["k"] == 7
    if doc_ids is not None:
        assert session.params["doc_ids"] == doc_ids


async def test_multi_query_search_fuses_and_ranks(monkeypatch: pytest.MonkeyPatch) -> None:
    from paperpilot import retrieve

    async def fake_hybrid(
        session: Any,
        user_id: str,
        query: str,
        query_embedding: list[float],
        k: int = 5,
        doc_ids: list[str] | None = None,
    ) -> list[dict[str, Any]]:
        if query == "q1":
            return [{"id": "c-1", "text": "a"}, {"id": "c-2", "text": "b"}]
        return [{"id": "c-2", "text": "b"}, {"id": "c-3", "text": "c"}]

    monkeypatch.setattr(retrieve, "hybrid_search", fake_hybrid)
    rows = await retrieve.multi_query_search(
        cast(AsyncSession, object()),
        "u-1",
        ["q1", "q2"],
        [[0.0], [0.0]],
        pool=10,
    )
    ids = [r["id"] for r in rows]
    assert ids[0] == "c-2"
    assert set(ids) == {"c-1", "c-2", "c-3"}
    assert len(ids) == 3


async def test_multi_query_search_respects_pool(monkeypatch: pytest.MonkeyPatch) -> None:
    from paperpilot import retrieve

    async def fake_hybrid(
        session: Any,
        user_id: str,
        query: str,
        query_embedding: list[float],
        k: int = 5,
        doc_ids: list[str] | None = None,
    ) -> list[dict[str, Any]]:
        return [{"id": f"c-{i}", "text": "x"} for i in range(5)]

    monkeypatch.setattr(retrieve, "hybrid_search", fake_hybrid)
    rows = await retrieve.multi_query_search(
        cast(AsyncSession, object()), "u-1", ["q1"], [[0.0]], pool=3
    )
    assert len(rows) == 3
