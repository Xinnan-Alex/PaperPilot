from __future__ import annotations

import os
from typing import Any

import httpx

from paperpilot.tools import ToolContext, ToolSpec, register

TAVILY_URL = "https://api.tavily.com/search"


async def _handle(args: dict[str, Any], ctx: ToolContext) -> dict[str, Any]:
    api_key = os.getenv("TAVILY_API_KEY")
    if not api_key:
        return {"error": "web_search disabled: TAVILY_API_KEY not set"}

    query = str(args["query"])
    max_results = int(args.get("max_results", 5))
    payload = {
        "api_key": api_key,
        "query": query,
        "max_results": max_results,
        "search_depth": "basic",
    }
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.post(TAVILY_URL, json=payload)

    if resp.status_code >= 400:
        return {"error": f"tavily request failed: {resp.status_code} {resp.text[:200]}"}

    data = resp.json()
    results = data.get("results", [])
    return {
        "results": [
            {
                "title": r.get("title", ""),
                "url": r.get("url", ""),
                "snippet": r.get("content", ""),
            }
            for r in results[:max_results]
        ]
    }


SPEC: ToolSpec = {
    "name": "web_search",
    "description": (
        "USE WHEN: the user asks about recent events, current information, public "
        "facts, or anything the uploaded documents do not cover. Returns title, "
        "URL, and snippet for each result. "
        "DO NOT USE for: questions answerable from the user's uploaded documents "
        "(try search_documents first)."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "query": {"type": "string", "description": "Search query."},
            "max_results": {
                "type": "integer",
                "description": "Max results to return (1-10).",
                "minimum": 1,
                "maximum": 10,
            },
        },
        "required": ["query"],
    },
    "handler": _handle,
}


def register_tool_if_enabled() -> None:
    if os.getenv("TAVILY_API_KEY"):
        register(SPEC)
