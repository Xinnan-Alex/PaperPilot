from __future__ import annotations

from typing import Any

from sqlalchemy import text

from paperpilot.store import list_documents
from paperpilot.tools import ToolContext, ToolSpec, register

SUMMARY_CHUNK_LIMIT = 5
SUMMARY_CHAR_LIMIT = 4000


async def _list_handler(args: dict[str, Any], ctx: ToolContext) -> dict[str, Any]:
    rows = await list_documents(ctx.db_session, ctx.user_id)
    return {
        "documents": [
            {"id": str(r["id"]), "filename": r["filename"], "status": r["status"]}
            for r in rows
        ]
    }


async def _fetch_first_chunks(
    session: Any, user_id: str, document_id: str, limit: int
) -> list[dict[str, Any]]:
    result = await session.execute(
        text(
            "SELECT text FROM chunks "
            "WHERE user_id = :user_id AND document_id = :document_id "
            "ORDER BY ordinal ASC LIMIT :limit"
        ),
        {"user_id": user_id, "document_id": document_id, "limit": limit},
    )
    return [{"text": row[0]} for row in result.fetchall()]


async def _summary_handler(args: dict[str, Any], ctx: ToolContext) -> dict[str, Any]:
    document_id = str(args["document_id"])
    rows = await _fetch_first_chunks(
        ctx.db_session, ctx.user_id, document_id, SUMMARY_CHUNK_LIMIT
    )
    if not rows:
        return {"error": f"document {document_id} not found or has no chunks"}
    combined = "\n\n".join(r["text"] for r in rows)
    return {"summary": combined[:SUMMARY_CHAR_LIMIT]}


LIST_SPEC: ToolSpec = {
    "name": "list_documents",
    "description": "List the documents the user has uploaded. Returns id, filename, and status.",
    "parameters": {"type": "object", "properties": {}},
    "handler": _list_handler,
}

SUMMARY_SPEC: ToolSpec = {
    "name": "get_document_summary",
    "description": (
        "Get a short summary of a document by concatenating its first 5 chunks "
        "(truncated to 4000 characters). Use when you need an overview of a "
        "specific document without searching for a particular topic."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "document_id": {"type": "string", "description": "The document id (uuid)."}
        },
        "required": ["document_id"],
    },
    "handler": _summary_handler,
}


def register_tools() -> None:
    register(LIST_SPEC)
    register(SUMMARY_SPEC)
