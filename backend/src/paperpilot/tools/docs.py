from __future__ import annotations

from typing import Any

from sqlalchemy import text

from paperpilot.store import list_documents
from paperpilot.tools import ToolContext, ToolSpec, register

SUMMARY_CHUNK_LIMIT = 5
SUMMARY_CHAR_LIMIT = 4000


async def _list_handler(args: dict[str, Any], ctx: ToolContext) -> dict[str, Any]:
    rows = await list_documents(ctx.db_session, ctx.user_id)
    allowed = set(ctx.doc_ids) if ctx.doc_ids else None
    return {
        "documents": [
            {"id": str(r["id"]), "filename": r["filename"], "status": r["status"]}
            for r in rows
            if allowed is None or str(r["id"]) in allowed
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
    if ctx.doc_ids and document_id not in ctx.doc_ids:
        return {"error": f"document {document_id} is not in the selected document scope"}
    rows = await _fetch_first_chunks(
        ctx.db_session, ctx.user_id, document_id, SUMMARY_CHUNK_LIMIT
    )
    if not rows:
        return {"error": f"document {document_id} not found or has no chunks"}
    combined = "\n\n".join(r["text"] for r in rows)
    return {"summary": combined[:SUMMARY_CHAR_LIMIT]}


LIST_SPEC: ToolSpec = {
    "name": "list_documents",
    "description": (
        "USE WHEN: the user asks what documents they have, what files are "
        "available, or to see their document library. Returns id, filename, "
        "and status for each document. Takes no arguments. "
        "DO NOT USE for: searching inside documents (use search_documents) or "
        "reading a specific document's content (use get_document_summary)."
    ),
    "parameters": {
        "type": "object",
        "properties": {},
        "additionalProperties": False,
    },
    "handler": _list_handler,
}

SUMMARY_SPEC: ToolSpec = {
    "name": "get_document_summary",
    "description": (
        "USE WHEN: the user asks for an overview/summary of a specific document "
        "by id, or asks 'what is this document about'. Returns the first 5 chunks "
        "(up to 4000 chars) concatenated. "
        "DO NOT USE for: targeted questions about a topic (use search_documents) "
        "or when you don't already know the document id (use list_documents first)."
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
