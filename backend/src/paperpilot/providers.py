from __future__ import annotations

import os
from dataclasses import dataclass

from fastapi import HTTPException


@dataclass(frozen=True)
class ModelSpec:
    id: str
    litellm_id: str
    provider: str
    display_name: str
    supports_tools: bool
    context_window: int
    api_key_env: str


MODELS: list[ModelSpec] = [
    ModelSpec(
        id="gpt-4o",
        litellm_id="openai/gpt-4o",
        provider="openai",
        display_name="GPT-4o",
        supports_tools=True,
        context_window=128_000,
        api_key_env="OPENAI_API_KEY",
    ),
    ModelSpec(
        id="gpt-4o-mini",
        litellm_id="openai/gpt-4o-mini",
        provider="openai",
        display_name="GPT-4o mini",
        supports_tools=True,
        context_window=128_000,
        api_key_env="OPENAI_API_KEY",
    ),
    ModelSpec(
        id="deepseek-chat",
        litellm_id="deepseek/deepseek-chat",
        provider="deepseek",
        display_name="DeepSeek V3",
        supports_tools=True,
        context_window=64_000,
        api_key_env="DEEPSEEK_API_KEY",
    ),
    ModelSpec(
        id="llama-3.3-70b",
        litellm_id="groq/llama-3.3-70b-versatile",
        provider="groq",
        display_name="Llama 3.3 70B",
        supports_tools=True,
        context_window=128_000,
        api_key_env="GROQ_API_KEY",
    ),
    ModelSpec(
        id="mistral-large",
        litellm_id="mistral/mistral-large-latest",
        provider="mistral",
        display_name="Mistral Large",
        supports_tools=True,
        context_window=128_000,
        api_key_env="MISTRAL_API_KEY",
    ),
]


def available_models() -> list[ModelSpec]:
    return [m for m in MODELS if os.getenv(m.api_key_env)]


def resolve(model_id: str) -> ModelSpec:
    for m in available_models():
        if m.id == model_id:
            return m
    raise HTTPException(status_code=404, detail=f"Model '{model_id}' is not available")
