from __future__ import annotations

from paperpilot.config import settings
from paperpilot.providers import ModelSpec, retrieval_budget


def _spec(**kw: object) -> ModelSpec:
    base: dict[str, object] = dict(
        id="m",
        litellm_id="p/m",
        provider="p",
        display_name="M",
        context_window=1000,
        api_key_env="X",
    )
    base.update(kw)
    return ModelSpec(**base)  # type: ignore[arg-type]


def test_budget_global_default_when_unset() -> None:
    assert retrieval_budget(_spec()) == (
        settings.retrieval_top_k,
        settings.retrieval_context_chars,
    )


def test_budget_per_model_override() -> None:
    spec = _spec(retrieval_top_k=8, retrieval_context_chars=20000)
    assert retrieval_budget(spec) == (8, 20000)


def test_budget_none_spec_uses_global() -> None:
    assert retrieval_budget(None) == (
        settings.retrieval_top_k,
        settings.retrieval_context_chars,
    )
