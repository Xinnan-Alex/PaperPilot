from __future__ import annotations

import os
from pathlib import Path

from fastapi import HTTPException
from pydantic import BaseModel, ConfigDict

from paperpilot.config import settings


class Badge(BaseModel):
    model_config = ConfigDict(frozen=True)

    label: str
    color: str


class ProviderSpec(BaseModel):
    model_config = ConfigDict(frozen=True)

    id: str
    display_name: str
    enabled: bool = True
    api_key_env: str
    badge: Badge


class ModelSpec(BaseModel):
    model_config = ConfigDict(frozen=True)

    id: str
    litellm_id: str
    provider: str
    display_name: str
    supports_tools: bool = True
    context_window: int
    api_key_env: str
    enabled: bool = True
    default: bool = False


class _ModelManifestEntry(BaseModel):
    id: str
    litellm_id: str
    display_name: str
    supports_tools: bool = True
    context_window: int
    enabled: bool = True
    default: bool = False


class _ProviderManifestEntry(BaseModel):
    display_name: str
    enabled: bool = True
    api_key_env: str
    badge: Badge
    models: list[_ModelManifestEntry]


class _Manifest(BaseModel):
    providers: dict[str, _ProviderManifestEntry]


def _load_manifest(path: Path) -> tuple[dict[str, ProviderSpec], list[ModelSpec]]:
    parsed = _Manifest.model_validate_json(path.read_text())

    providers_map: dict[str, ProviderSpec] = {}
    models_list: list[ModelSpec] = []
    seen_model_ids: set[str] = set()

    for pid, pcfg in parsed.providers.items():
        providers_map[pid] = ProviderSpec(
            id=pid,
            display_name=pcfg.display_name,
            enabled=pcfg.enabled,
            api_key_env=pcfg.api_key_env,
            badge=pcfg.badge,
        )
        for m in pcfg.models:
            if m.id in seen_model_ids:
                raise ValueError(f"Duplicate model id '{m.id}' in {path}")
            seen_model_ids.add(m.id)
            models_list.append(
                ModelSpec(
                    id=m.id,
                    litellm_id=m.litellm_id,
                    provider=pid,
                    display_name=m.display_name,
                    supports_tools=m.supports_tools,
                    context_window=m.context_window,
                    api_key_env=pcfg.api_key_env,
                    enabled=m.enabled,
                    default=m.default,
                )
            )

    defaults = [m.id for m in models_list if m.default]
    if len(defaults) > 1:
        raise ValueError(
            f"Multiple models flagged as default ({defaults}) in {path}; only one allowed"
        )
    return providers_map, models_list


PROVIDERS, MODELS = _load_manifest(settings.models_manifest_path)


def available_models() -> list[ModelSpec]:
    return [
        m
        for m in MODELS
        if m.enabled and PROVIDERS[m.provider].enabled and os.getenv(m.api_key_env)
    ]


def available_providers() -> list[ProviderSpec]:
    in_use = {m.provider for m in available_models()}
    return [PROVIDERS[pid] for pid in PROVIDERS if pid in in_use]


def default_model() -> ModelSpec | None:
    for m in available_models():
        if m.default:
            return m
    return None


def resolve(model_id: str) -> ModelSpec:
    for m in available_models():
        if m.id == model_id:
            return m
    raise HTTPException(status_code=404, detail=f"Model '{model_id}' is not available")
