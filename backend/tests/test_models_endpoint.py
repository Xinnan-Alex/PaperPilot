from __future__ import annotations

import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def client(monkeypatch: pytest.MonkeyPatch, clear_provider_env: None) -> TestClient:
    monkeypatch.setenv("OPENAI_API_KEY", "sk-test")
    from paperpilot import config

    monkeypatch.setattr(config.settings, "supabase_jwks_url", "http://localhost/.well-known/jwks.json")
    monkeypatch.setattr(config.settings, "supabase_db_url", "postgresql+asyncpg://user:pass@localhost/db")
    from paperpilot import api, auth

    api.app.dependency_overrides[auth.current_user] = lambda: "u-1"
    return TestClient(api.app)


def test_models_returns_only_enabled(client: TestClient) -> None:
    resp = client.get("/models", headers={"Authorization": "Bearer dummy"})
    assert resp.status_code == 200
    data = resp.json()
    ids = {m["id"] for m in data}
    assert "gpt-4o" in ids
    assert "gpt-4o-mini" in ids
    assert "deepseek-chat" not in ids
    for m in data:
        assert set(m.keys()) >= {"id", "display_name", "provider"}
