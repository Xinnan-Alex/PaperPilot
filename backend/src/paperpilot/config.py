from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    env: str = "local"
    supabase_url: str = ""
    supabase_jwks_url: str = ""
    supabase_secret_key: str = ""
    supabase_db_url: str = ""
    supabase_storage_bucket: str = "documents"
    deepseek_api_key: str = ""
    llm_base_url: str = "https://api.deepseek.com"
    llm_model: str = "deepseek-chat"
    voyage_api_key: str = ""
    embedding_model: str = "voyage-3-lite"
    embedding_dim: int = 512
    frontend_origins: str = "http://localhost:5173"

    model_config = {"env_file": ".env", "env_file_encoding": "utf-8"}


settings = Settings()
