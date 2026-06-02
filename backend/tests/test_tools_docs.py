from __future__ import annotations

from typing import Any

import pytest

from paperpilot import tools
from paperpilot.tools import docs as docs_tool


@pytest.fixture(autouse=True)
def isolate_registry(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(tools, "REGISTRY", {})
    docs_tool.register_tools()


async def test_list_documents(monkeypatch: pytest.MonkeyPatch) -> None:
    async def fake_list(session: Any, user_id: str) -> list[dict[str, Any]]:
        assert user_id == "u-1"
        return [
            {"id": "d-1", "filename": "a.pdf", "status": "ready", "created_at": "x"},
            {"id": "d-2", "filename": "b.pdf", "status": "pending", "created_at": "x"},
        ]

    monkeypatch.setattr(docs_tool, "list_documents", fake_list)
    ctx = tools.ToolContext(user_id="u-1", access_token="t", doc_ids=None, db_session=object())
    result = await tools.dispatch("list_documents", {}, ctx)
    assert result == {
        "documents": [
            {"id": "d-1", "filename": "a.pdf", "status": "ready"},
            {"id": "d-2", "filename": "b.pdf", "status": "pending"},
        ]
    }


async def test_get_document_summary_truncates(monkeypatch: pytest.MonkeyPatch) -> None:
    long_text = "x" * 2000

    async def fake_fetch(
        session: Any, user_id: str, document_id: str, limit: int
    ) -> list[dict[str, Any]]:
        assert user_id == "u-1"
        assert document_id == "d-1"
        assert limit == 5
        return [{"text": long_text} for _ in range(5)]

    monkeypatch.setattr(docs_tool, "_fetch_first_chunks", fake_fetch)
    ctx = tools.ToolContext(user_id="u-1", access_token="t", doc_ids=None, db_session=object())
    result = await tools.dispatch("get_document_summary", {"document_id": "d-1"}, ctx)
    assert "summary" in result
    assert len(result["summary"]) == 4000


async def test_get_document_summary_missing(monkeypatch: pytest.MonkeyPatch) -> None:
    async def fake_fetch(
        session: Any, user_id: str, document_id: str, limit: int
    ) -> list[dict[str, Any]]:
        return []

    monkeypatch.setattr(docs_tool, "_fetch_first_chunks", fake_fetch)
    ctx = tools.ToolContext(user_id="u-1", access_token="t", doc_ids=None, db_session=object())
    result = await tools.dispatch("get_document_summary", {"document_id": "missing"}, ctx)
    assert "error" in result
