from __future__ import annotations

from collections.abc import Awaitable, Callable
from datetime import datetime
from pathlib import PosixPath
from typing import Any
import uuid as _uuid

import httpx
from fastapi import BackgroundTasks, Depends, FastAPI, File, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response, StreamingResponse
from slowapi import Limiter
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address

from paperpilot.auth import current_user
from paperpilot.chunk import chunk_pages
from paperpilot.config import settings
from paperpilot.db import get_db
from paperpilot.embed import embed_documents
from paperpilot.ingest import extract_text
from paperpilot.logging import configure_logging, generate_request_id, request_id_var
from paperpilot.models import (
    Chunk,
    DocumentOut,
    FeedbackIn,
    FeedbackOut,
    IngestRequest,
    MeResponse,
    Page,
    QueryRequest,
)
from paperpilot.reader import answer
from paperpilot.store import (
    get_document,
    insert_chunks,
    insert_document,
    list_documents,
    update_document_status,
)

configure_logging(settings.env)

app = FastAPI(title="PaperPilot API")

origins: list[str] = [o.strip() for o in settings.frontend_origins.split(",") if o.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


limiter = Limiter(key_func=get_remote_address, default_limits=["60/hour"])
app.state.limiter = limiter


def get_user_key(request: Request) -> str:
    user_id: str | None = getattr(request.state, "user_id", None)
    if user_id:
        return f"user:{user_id}"
    return get_remote_address(request)


@app.middleware("http")
async def request_id_middleware(
    request: Request, call_next: Callable[[Request], Awaitable[Response]]
) -> Response:
    rid: str = generate_request_id()
    request_id_var.set(rid)
    response = await call_next(request)
    response.headers["X-Request-ID"] = rid
    return response


@app.exception_handler(RateLimitExceeded)
async def rate_limit_handler(request: Request, exc: RateLimitExceeded) -> JSONResponse:
    return JSONResponse(
        status_code=429,
        content={"detail": "Rate limit exceeded. Please try again later."},
        headers={"Retry-After": "3600"},
    )


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/me", response_model=MeResponse)
async def me(request: Request, user_id: str = Depends(current_user)) -> dict[str, str]:
    return {"user_id": user_id, "email": getattr(request.state, "user_email", "")}


@app.post("/upload")
@limiter.limit("10/hour", key_func=get_user_key)
async def upload_file(
    request: Request,
    file: UploadFile = File(...),
    user_id: str = Depends(current_user),
) -> dict[str, str]:
    allowed_exts: set[str] = {".pdf", ".docx", ".doc", ".txt", ".text", ".md", ".html", ".htm"}
    ext: str = PosixPath(file.filename).suffix.lower() if file.filename else ""

    if ext not in allowed_exts:
        raise HTTPException(status_code=400, detail=f"Unsupported file type:{ext}")

    contents: bytes = await file.read()

    storage_path: str = f"documents/{user_id}/{file.filename}"
    upload_headers: dict[str, str] = {
        "Authorization": f"Bearer {settings.supabase_secret_key}",
        "x-upsert": "true",
    }
    async with httpx.AsyncClient(timeout=30) as client:
        resp: httpx.Response = await client.post(
            f"{settings.supabase_url}/storage/v1/object/{settings.supabase_storage_bucket}/{storage_path}",
            content=contents,
            headers=upload_headers,
        )

        if resp.status_code >= 400:
            raise HTTPException(status_code=502, detail=f"Storage upload failed: {resp.text}")

    async for session in get_db():
        doc_id: str = await insert_document(session, user_id, file.filename, storage_path)
        return {"doc_id": doc_id, "filename": file.filename}


async def _run_ingest_pipeline(doc_id: str, user_id: str, filename: str, storage_path: str) -> None:
    async with httpx.AsyncClient(timeout=30) as client:
        download_resp: httpx.Response = await client.get(
            f"{settings.supabase_url}/storage/v1/object/{settings.supabase_storage_bucket}/{storage_path}",
            headers={"Authorization": f"Bearer {settings.supabase_secret_key}"},
        )
        if download_resp.status_code >= 400:
            async for session in get_db():
                await update_document_status(session, doc_id, "failed")
            return

        file_bytes: bytes = download_resp.content

    tmp_path: PosixPath = PosixPath(f"/tmp/pilot_{doc_id}.dat")
    tmp_path.write_bytes(file_bytes)

    try:
        pages: list[Page] = extract_text(str(tmp_path))
        chunks: list[Chunk] = chunk_pages(pages)
        texts: list[str] = [c.text for c in chunks]
        embedding: list[list[float]] = embed_documents(texts)
        for chunk, emb in zip(chunks, embedding):
            chunk.embedding = emb

        async for session in get_db():
            await insert_chunks(session, user_id, doc_id, chunks)
            await update_document_status(session, doc_id, "ready")

    except Exception:
        async for session in get_db():
            await update_document_status(session, doc_id, "failed")
            raise
    finally:
        tmp_path.unlink(missing_ok=True)


@app.post("/ingest", status_code=202)
@limiter.limit("10/hour", key_func=get_user_key)
async def ingest_document(
    request: Request,
    background_tasks: BackgroundTasks,
    body: IngestRequest,
    user_id: str = Depends(current_user),
) -> dict[str, str]:
    async for session in get_db():
        from sqlalchemy import text

        result = await session.execute(
            text(
                "SELECT filename, storage_path, status FROM documents WHERE id = :id AND user_id = :user_id"
            ),
            {"id": body.doc_id, "user_id": user_id},
        )
        row = result.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Document not found")

        filename: str = row[0]
        storage_path_val: str = row[1]
        current_status: str = row[2]

        if current_status == "ready":
            raise HTTPException(status_code=409, detail="Document already ingested")

        if current_status == "processing":
            raise HTTPException(status_code=409, detail="Document is currently being processed")

        await update_document_status(session, body.doc_id, "processing")

    background_tasks.add_task(
        _run_ingest_pipeline, body.doc_id, user_id, filename, storage_path_val
    )
    return {"doc_id": body.doc_id, "status": "processing"}


@app.get("/document/{doc_id}", response_model=DocumentOut)
async def get_document_status(
    doc_id: str,
    user_id: str = Depends(current_user),
) -> DocumentOut:
    async for session in get_db():
        doc: dict[str, Any] | None = await get_document(session, user_id, doc_id)

    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    return DocumentOut(**doc)


@app.post("/query")
@limiter.limit("30/hour", key_func=get_user_key)
async def query(
    request: Request,
    body: QueryRequest,
    user_id: str = Depends(current_user),
) -> StreamingResponse:
    return StreamingResponse(
        answer(body.query, user_id, top_k=body.top_k, doc_ids=body.doc_ids),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@app.get("/documents", response_model=list[DocumentOut])
async def get_documents(user_id: str = Depends(current_user)) -> list[DocumentOut]:
    async for session in get_db():
        docs: list[dict[str, Any]] = await list_documents(session, user_id)
    return [DocumentOut(**d) for d in docs]


@app.post("/feedback", response_model=FeedbackOut)
async def submit_feedback(
    body: FeedbackIn,
    user_id: str = Depends(current_user),
) -> FeedbackOut:
    async for session in get_db():
        from sqlalchemy import text

        fid: str = str(_uuid.uuid4())
        now: datetime = datetime.now(datetime.UTC)
        stmt = text("""
            INSERT INTO feedback (id, user_id, query, answer, rating, retrieved_chunk_ids, created_at) VALUES (:id, :user_id, :query, :answer, :rating, :chunk_ids, :now)
        """)
        await session.execute(
            stmt,
            {
                "id": fid,
                "user_id": user_id,
                "query": body.query,
                "answer": body.answer,
                "rating": body.rating,
                "chunk_ids": body.retrieved_chunk_ids,
                "now": now,
            },
        )
        await session.commit()
    return FeedbackOut(id=fid, created_at=now)
