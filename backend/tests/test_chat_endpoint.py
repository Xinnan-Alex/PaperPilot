from __future__ import annotations

from collections.abc import AsyncIterator
from typing import Any

import pytest
from fastapi.testclient import TestClient


def _delta(content: str | None = None, tool_calls: list[Any] | None = None) -> Any:
    class D:
        def __init__(self) -> None:
            self.content = content
            self.tool_calls = tool_calls

    class Choice:
        def __init__(self) -> None:
            self.delta = D()

    class Chunk:
        def __init__(self) -> None:
            self.choices = [Choice()]

    return Chunk()


@pytest.fixture
def client(monkeypatch: pytest.MonkeyPatch, clear_provider_env: None) -> TestClient:
    monkeypatch.setenv("DEEPSEEK_API_KEY", "sk-test")
    from paperpilot import config

    monkeypatch.setattr(config.settings, "supabase_jwks_url", "http://localhost/.well-known/jwks.json")
    monkeypatch.setattr(config.settings, "supabase_db_url", "postgresql+asyncpg://user:pass@localhost/db")
    from paperpilot import agent, api, auth

    api.app.dependency_overrides[auth.current_user] = lambda: "u-1"

    async def fake_get_db() -> AsyncIterator[Any]:
        yield object()

    monkeypatch.setattr(api, "get_db", fake_get_db)

    async def fake_stream(**kwargs: Any) -> AsyncIterator[Any]:
        yield _delta(content="hi")

    monkeypatch.setattr(agent, "stream_completion", fake_stream)
    return TestClient(api.app)


def test_chat_streams_tokens(client: TestClient) -> None:
    body = {
        "messages": [{"role": "user", "content": "hello"}],
        "model_id": "deepseek-chat",
    }
    with client.stream("POST", "/chat", json=body, headers={"Authorization": "Bearer x"}) as resp:
        assert resp.status_code == 200
        text = "".join(resp.iter_text())
    assert "event: token" in text
    assert "hi" in text
    assert "event: done" in text


def test_chat_unknown_model_returns_404(client: TestClient) -> None:
    body = {
        "messages": [{"role": "user", "content": "hi"}],
        "model_id": "nope",
    }
    resp = client.post("/chat", json=body, headers={"Authorization": "Bearer x"})
    assert resp.status_code == 404
