from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

_BACKEND_ROOT = Path(__file__).resolve().parent.parent.parent


class Settings(BaseSettings):
    env: str = "local"

    # Model manifest (providers + models registry)
    models_manifest_path: Path = _BACKEND_ROOT / "models.json"

    # Supabase
    supabase_url: str = ""
    supabase_jwks_url: str = ""
    supabase_secret_key: str = ""
    supabase_publishable_key: str = ""
    supabase_db_url: str = ""
    supabase_storage_bucket: str = "documents"

    # Embeddings (Voyage)
    voyage_api_key: str = ""
    embedding_model: str = "voyage-3-lite"
    embedding_dim: int = 512

    # OCR / docs
    ocr_language: str = "eng"

    # CORS
    frontend_origins: str = "http://localhost:5173"

    # LLM provider keys — presence enables the model in /models
    openai_api_key: str = ""
    deepseek_api_key: str = ""
    groq_api_key: str = ""
    mistral_api_key: str = ""

    # Tool provider keys
    tavily_api_key: str = ""

    # Agent defaults
    default_model_id: str = "deepseek-chat"
    agent_max_iterations: int = 5

    # Eval / judge (existing)
    judge_model: str = "gpt-4o-mini"
    judge_base_url: str = "https://api.openai.com/v1"
    judge_api_key: str = ""

    # Deprecated (kept for one release for back-compat with /query path)
    llm_base_url: str = "https://api.deepseek.com"
    llm_model: str = "deepseek-chat"

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")


settings = Settings()
