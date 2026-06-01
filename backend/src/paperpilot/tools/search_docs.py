from __future__ import annotations

from typing import Any

from paperpilot.embed import embed_query
from paperpilot.retrieve import hybrid_search
from paperpilot.tools import ToolContext, ToolSpec, register


async def _handle(args: dict[str, Any], ctx: ToolContext) -> dict[str, Any]:
    query = str(args["query"])
    top_k = int(args.get("top_k", 5))
    embedding = embed_query(query)
    rows = await hybrid_search(
        ctx.db_session,
        ctx.user_id,
        query,
        embedding,
        k=top_k,
        doc_ids=ctx.doc_ids,
    )
    return {
        "chunks": [
            {
                "chunk_id": str(r.get("id", "")),
                "document_id": str(r.get("document_id", "")),
                "ordinal": r.get("ordinal", 0),
                "page": r.get("page"),
                "text": r.get("text", ""),
                "filename": r.get("filename", "unknown"),
            }
            for r in rows
        ]
    }


SPEC: ToolSpec = {
    "name": "search_documents",
    "description": (
        "Search the user's uploaded documents for passages relevant to a query. "
        "Returns the top-k chunks with filename, page, and text. Use this whenever "
        "you need information that is likely contained in the user's documents."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "query": {"type": "string", "description": "A natural-language search query."},
            "top_k": {
                "type": "integer",
                "description": "Maximum number of chunks to return (1-20).",
                "minimum": 1,
                "maximum": 20,
            },
        },
        "required": ["query"],
    },
    "handler": _handle,
}


def register_tool() -> None:
    register(SPEC)
