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
