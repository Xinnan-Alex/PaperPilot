from __future__ import annotations

import pytest
from fastapi import HTTPException

from paperpilot import providers


def test_available_models_filters_by_env(
    monkeypatch: pytest.MonkeyPatch, clear_provider_env: None
) -> None:
    monkeypatch.setenv("OPENAI_API_KEY", "sk-test")
    available = providers.available_models()
    ids = {m.id for m in available}
    assert "gpt-4o" in ids
    assert "gpt-4o-mini" in ids
    assert "deepseek-chat" not in ids
    assert "llama-3.3-70b" not in ids


def test_available_models_empty_when_no_keys(clear_provider_env: None) -> None:
    assert providers.available_models() == []


def test_resolve_known_model(monkeypatch: pytest.MonkeyPatch, clear_provider_env: None) -> None:
    monkeypatch.setenv("DEEPSEEK_API_KEY", "sk-test")
    spec = providers.resolve("deepseek-chat")
    assert spec.id == "deepseek-chat"
    assert spec.litellm_id == "deepseek/deepseek-chat"


def test_resolve_unknown_model_raises(clear_provider_env: None) -> None:
    with pytest.raises(HTTPException) as exc:
        providers.resolve("nonexistent-model")
    assert exc.value.status_code == 404


def test_resolve_disabled_model_raises(clear_provider_env: None) -> None:
    # gpt-4o is in MODELS but OPENAI_API_KEY is unset.
    with pytest.raises(HTTPException) as exc:
        providers.resolve("gpt-4o")
    assert exc.value.status_code == 404
