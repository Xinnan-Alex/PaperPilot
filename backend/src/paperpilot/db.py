from __future__ import annotations

from collections.abc import AsyncGenerator

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from paperpilot.config import settings

engine = create_async_engine(
    settings.supabase_db_url,
    pool_size=5,
    max_overflow=5,
    pool_pre_ping=True,
    connect_args={"statement_cache_size": 0},
)

async_session = async_sessionmaker(engine, expire_on_commit=False)


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    async with async_session() as session:
        try:
            yield session
        finally:
            await session.close()
