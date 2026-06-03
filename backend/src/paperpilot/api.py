from __future__ import annotations

import time
import uuid as _uuid
from collections.abc import AsyncIterator, Awaitable, Callable
from datetime import datetime
from pathlib import PosixPath
from typing import Any
from urllib.parse import quote

import httpx
from fastapi import BackgroundTasks, Depends, FastAPI, File, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response, StreamingResponse
from slowapi import Limiter
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address

import paperpilot.providers as _providers
from paperpilot import agent as _agent
from paperpilot.auth import AuthError, current_user
from paperpilot.chunk import chunk_pages
from paperpilot.config import settings
from paperpilot.db import get_db
from paperpilot.embed import embed_documents
from paperpilot.ingest import extract_text
from paperpilot.logging import configure_logging, generate_request_id, get_logger, request_id_var
from paperpilot.models import (
    ChatRequest,
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
from paperpilot.tools import docs as _docs_tool
from paperpilot.tools import search_docs as _search_docs_tool
from paperpilot.tools import web_search as _web_search_tool

configure_logging(settings.env)

_search_docs_tool.register_tool()
_docs_tool.register_tools()
_web_search_tool.register_tool_if_enabled()

app = FastAPI(title="PaperPilot API")

_log = get_logger().bind(component="startup")


@app.on_event("startup")
async def _startup_provider_check() -> None:
    enabled = [m.id for m in _providers.available_models()]
    if not enabled:
        _log.error(
            "no_llm_providers_configured",
            message="No LLM provider API keys set; /chat and /query will fail",
        )
    else:
        _log.info("llm_providers_enabled", models=enabled)
    if settings.default_model_id not in enabled and enabled:
        _log.warning(
            "default_model_unavailable",
            default_model_id=settings.default_model_id,
            fallback=enabled[0],
        )


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

metrics: dict[str, float | int] = {
    "requests_total": 0,
    "errors_total": 0,
    "latency_total_ms": 0.0,
}


def supabase_admin_headers(content_type: str | None = None) -> dict[str, str]:
    headers: dict[str, str] = {"apikey": settings.supabase_secret_key}
    if content_type:
        headers["Content-Type"] = content_type
    return headers


def supabase_user_headers(access_token: str, content_type: str | None = None) -> dict[str, str]:
    headers: dict[str, str] = {
        "apikey": settings.supabase_publishable_key or settings.supabase_secret_key,
        "Authorization": f"Bearer {access_token}",
    }
    if content_type:
        headers["Content-Type"] = content_type
    return headers


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
    start = time.perf_counter()
    log = get_logger().bind(
        request_id=rid,
        method=request.method,
        path=request.url.path,
    )
    try:
        response = await call_next(request)
    except Exception:
        latency_ms = (time.perf_counter() - start) * 1000
        metrics["requests_total"] += 1
        metrics["latency_total_ms"] += latency_ms
        metrics["errors_total"] += 1
        log.exception("request_unhandled_exception", latency_ms=round(latency_ms, 2))
        raise

    latency_ms = (time.perf_counter() - start) * 1000
    metrics["requests_total"] += 1
    metrics["latency_total_ms"] += latency_ms
    if response.status_code >= 500:
        metrics["errors_total"] += 1
        log.error(
            "request_server_error",
            status=response.status_code,
            latency_ms=round(latency_ms, 2),
        )
    elif response.status_code >= 400:
        log.warning(
            "request_client_error",
            status=response.status_code,
            latency_ms=round(latency_ms, 2),
        )
    else:
        log.info(
            "request_complete",
            status=response.status_code,
            latency_ms=round(latency_ms, 2),
        )
    response.headers["X-Request-ID"] = rid
    return response


@app.exception_handler(RateLimitExceeded)
async def rate_limit_handler(request: Request, exc: RateLimitExceeded) -> JSONResponse:
    get_logger().warning(
        "rate_limit_exceeded",
        path=request.url.path,
        client=get_remote_address(request),
    )
    return JSONResponse(
        status_code=429,
        content={"detail": "Rate limit exceeded. Please try again later."},
        headers={"Retry-After": "3600"},
    )


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    get_logger().exception(
        "unhandled_exception",
        path=request.url.path,
        method=request.method,
        exc_type=type(exc).__name__,
    )
    return JSONResponse(
        status_code=500,
        content={"detail": "Internal server error"},
    )


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/status")
async def status() -> dict[str, float | int | str]:
    requests_total = int(metrics["requests_total"])
    avg_latency_ms = float(metrics["latency_total_ms"]) / requests_total if requests_total else 0.0
    return {
        "status": "ok",
        "requests_total": requests_total,
        "errors_total": int(metrics["errors_total"]),
        "avg_latency_ms": round(avg_latency_ms, 2),
    }


@app.get("/me", response_model=MeResponse)
async def me(request: Request, user_id: str = Depends(current_user)) -> dict[str, str]:
    return {"user_id": user_id, "email": getattr(request.state, "user_email", "")}


@app.get("/models")
async def list_available_models(user_id: str = Depends(current_user)) -> list[dict[str, str]]:
    return [
        {"id": m.id, "display_name": m.display_name, "provider": m.provider}
        for m in _providers.available_models()
    ]


@app.post("/upload")
@limiter.limit("10/hour", key_func=get_user_key)
async def upload_file(
    request: Request,
    file: UploadFile = File(...),
    user_id: str = Depends(current_user),
) -> dict[str, str]:
    max_upload_bytes = 20 * 1024 * 1024  # 20 MB demo limit
    allowed_exts: set[str] = {".pdf", ".docx", ".txt", ".text", ".md", ".html", ".htm"}
    ext: str = PosixPath(file.filename).suffix.lower() if file.filename else ""

    if ext not in allowed_exts:
        raise HTTPException(status_code=400, detail=f"Unsupported file type: {ext}")

    contents: bytes = await file.read()
    if len(contents) > max_upload_bytes:
        raise HTTPException(status_code=413, detail="File too large. Max upload size is 20 MB.")

    access_token: str | None = getattr(request.state, "access_token", None)
    if not access_token:
        raise AuthError("Missing access token")

    original_filename = file.filename or f"upload{ext}"
    storage_path: str = f"{user_id}/{_uuid.uuid4()}{ext}"
    upload_headers = supabase_user_headers(
        access_token, file.content_type or "application/octet-stream"
    )
    async with httpx.AsyncClient(timeout=30) as client:
        resp: httpx.Response = await client.post(
            f"{settings.supabase_url}/storage/v1/object/{settings.supabase_storage_bucket}/{storage_path}",
            content=contents,
            headers=upload_headers,
        )

        if resp.status_code >= 400:
            get_logger().error(
                "storage_upload_failed",
                user_id=user_id,
                storage_path=storage_path,
                status=resp.status_code,
                body=resp.text[:500],
            )
            raise HTTPException(status_code=502, detail=f"Storage upload failed: {resp.text}")

    async for session in get_db():
        doc_id: str = await insert_document(session, user_id, original_filename, storage_path)
        get_logger().info(
            "document_uploaded",
            user_id=user_id,
            doc_id=doc_id,
            filename=original_filename,
            size_bytes=len(contents),
        )
        return {"doc_id": doc_id, "filename": original_filename}


async def _run_ingest_pipeline(doc_id: str, user_id: str, filename: str, storage_path: str) -> None:
    log = get_logger().bind(doc_id=doc_id, user_id=user_id, filename=filename)
    log.info("ingest_started")
    start = time.perf_counter()
    async with httpx.AsyncClient(timeout=30) as client:
        download_resp: httpx.Response = await client.get(
            f"{settings.supabase_url}/storage/v1/object/{settings.supabase_storage_bucket}/{storage_path}",
            headers=supabase_admin_headers(),
        )
        if download_resp.status_code >= 400:
            log.error(
                "ingest_storage_download_failed",
                storage_path=storage_path,
                status=download_resp.status_code,
                body=download_resp.text[:500],
            )
            async for session in get_db():
                await update_document_status(session, doc_id, "failed")
            return

        file_bytes: bytes = download_resp.content

    tmp_path: PosixPath = PosixPath(f"/tmp/pilot_{doc_id}{PosixPath(filename).suffix.lower()}")
    tmp_path.write_bytes(file_bytes)

    try:
        pages: list[Page] = extract_text(str(tmp_path))
        log.info("ingest_extracted", page_count=len(pages))
        if not pages:
            log.warning("ingest_no_text_extracted", size_bytes=len(file_bytes))

        chunks: list[Chunk] = chunk_pages(pages)
        log.info("ingest_chunked", chunk_count=len(chunks))

        texts: list[str] = [c.text for c in chunks]
        embedding: list[list[float]] = embed_documents(texts)
        log.info("ingest_embedded", embedding_count=len(embedding))

        for chunk, emb in zip(chunks, embedding):
            chunk.embedding = emb

        async for session in get_db():
            await insert_chunks(session, user_id, doc_id, chunks)
            await update_document_status(session, doc_id, "ready")

        log.info(
            "ingest_completed",
            chunk_count=len(chunks),
            duration_ms=round((time.perf_counter() - start) * 1000, 2),
        )

    except Exception:
        log.exception(
            "ingest_failed",
            duration_ms=round((time.perf_counter() - start) * 1000, 2),
        )
        async for session in get_db():
            await update_document_status(session, doc_id, "failed")
        return
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


@app.get("/documents/{doc_id}", response_model=DocumentOut)
async def get_document_status(
    doc_id: str,
    user_id: str = Depends(current_user),
) -> DocumentOut:
    async for session in get_db():
        doc: dict[str, Any] | None = await get_document(session, user_id, doc_id)

    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    return DocumentOut(**doc)


@app.get("/documents/{doc_id}/download-url")
async def get_document_download_url(
    doc_id: str,
    user_id: str = Depends(current_user),
) -> dict[str, str]:
    async for session in get_db():
        from sqlalchemy import text

        result = await session.execute(
            text("SELECT storage_path FROM documents WHERE id = :id AND user_id = :user_id"),
            {"id": doc_id, "user_id": user_id},
        )
        row = result.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Document not found")
        storage_path: str = row[0]

    encoded_path = quote(storage_path, safe="/")
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.post(
            f"{settings.supabase_url}/storage/v1/object/sign/{settings.supabase_storage_bucket}/{encoded_path}",
            headers=supabase_admin_headers(),
            json={"expiresIn": 300},
        )
    if resp.status_code >= 400:
        get_logger().error(
            "signed_url_failed",
            user_id=user_id,
            doc_id=doc_id,
            storage_path=storage_path,
            status=resp.status_code,
            body=resp.text[:500],
        )
        raise HTTPException(status_code=502, detail=f"Signed URL failed: {resp.text}")

    signed_path: str = resp.json().get("signedURL", "")
    return {"url": f"{settings.supabase_url}/storage/v1{signed_path}"}


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


@app.post("/chat")
@limiter.limit("30/hour", key_func=get_user_key)
async def chat(
    request: Request,
    body: ChatRequest,
    user_id: str = Depends(current_user),
) -> StreamingResponse:
    spec = _providers.resolve(body.model_id)
    access_token = getattr(request.state, "access_token", "") or ""

    async def stream() -> AsyncIterator[str]:
        async for session in get_db():
            async for evt in _agent.run(
                messages=[m.model_dump() for m in body.messages],
                user_id=user_id,
                model_id=spec.id,
                doc_ids=body.doc_ids,
                access_token=access_token,
                db_session=session,
                max_iterations=settings.agent_max_iterations,
            ):
                yield evt

    return StreamingResponse(
        stream(),
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

        # Validate that the referenced chunks belong to this user.
        if body.retrieved_chunk_ids:
            ownership = await session.execute(
                text(
                    "SELECT count(*) FROM chunks WHERE user_id = :user_id AND id = ANY(CAST(:ids AS uuid[]))"
                ),
                {"user_id": user_id, "ids": body.retrieved_chunk_ids},
            )
            if ownership.scalar_one() != len(body.retrieved_chunk_ids):
                raise HTTPException(status_code=400, detail="Feedback references unknown chunks")

        fid: str = str(_uuid.uuid4())
        now: datetime = datetime.now(tz=datetime.timezone.utc)
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
