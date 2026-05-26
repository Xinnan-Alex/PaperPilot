from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from paperpilot.config import settings

engine = create_async_engine(
    settings.supabase_db_url,
    pool_size=5,
    max_overflow=5,
    pool_pre_ping=True,
)

async_session = async_sessionmaker(engine, expire_on_commit=False)


async def get_db():
    async with async_session() as session:
        try:
            yield session
        finally:
            await session.close()
