from __future__ import annotations

import os

import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def client(monkeypatch: pytest.MonkeyPatch, clear_provider_env: None) -> TestClient:
    from paperpilot import config

    monkeypatch.setattr(
        config.settings, "supabase_jwks_url", "http://localhost/.well-known/jwks.json"
    )
    monkeypatch.setattr(
        config.settings, "supabase_db_url", "postgresql+asyncpg://user:pass@localhost/db"
    )
    from paperpilot import api, auth

    # litellm import (transitively pulled by paperpilot.llm) populates os.environ
    # from backend/.env, undoing clear_provider_env. Re-clear after imports.
    for var in ("OPENAI_API_KEY", "DEEPSEEK_API_KEY", "GROQ_API_KEY", "MISTRAL_API_KEY"):
        os.environ.pop(var, None)
    monkeypatch.setenv("OPENAI_API_KEY", "sk-test")

    api.app.dependency_overrides[auth.current_user] = lambda: "u-1"
    return TestClient(api.app)


def test_models_returns_only_enabled(client: TestClient) -> None:
    resp = client.get("/models", headers={"Authorization": "Bearer dummy"})
    assert resp.status_code == 200
    data = resp.json()
    assert set(data.keys()) >= {"providers", "models", "default_model_id"}

    model_ids = {m["id"] for m in data["models"]}
    assert "gpt-4o" in model_ids
    assert "gpt-4o-mini" in model_ids
    assert "deepseek-chat" not in model_ids
    for m in data["models"]:
        assert set(m.keys()) >= {
            "id",
            "display_name",
            "provider",
            "supports_tools",
            "context_window",
            "default",
        }

    # Manifest default is deepseek-chat, which is unavailable (no DEEPSEEK key).
    # Endpoint must return null rather than promoting a non-default fallback.
    assert data["default_model_id"] is None

    provider_ids = {p["id"] for p in data["providers"]}
    assert provider_ids == {"openai"}
    for p in data["providers"]:
        assert set(p.keys()) >= {"id", "display_name", "badge"}
        assert set(p["badge"].keys()) == {"label", "color"}
