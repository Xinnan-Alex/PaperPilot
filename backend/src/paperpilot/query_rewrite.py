from __future__ import annotations

import json

from paperpilot.llm import complete
from paperpilot.logging import get_logger

_log = get_logger().bind(component="query_rewrite")

_SYSTEM = (
    "You rewrite a search query into alternative phrasings to improve document "
    "retrieval. Return ONLY a JSON array of distinct standalone query strings "
    "(no prose, no markdown). Each variant must preserve the original intent but "
    "vary wording, synonyms, or specificity."
)


async def expand_query(query: str, litellm_id: str, n: int) -> list[str]:
    """Up to `n` alternative phrasings of `query`. Best-effort: returns [] on
    any failure, malformed output, or non-positive n."""
    if n <= 0:
        return []
    try:
        raw = await complete(
            model=litellm_id,
            messages=[
                {"role": "system", "content": _SYSTEM},
                {"role": "user", "content": f"Query: {query}\nReturn {n} variants."},
            ],
        )
        text = raw.strip()
        start, end = text.find("["), text.rfind("]")
        if start < 0 or end <= start:
            return []
        parsed = json.loads(text[start : end + 1])
        if not isinstance(parsed, list):
            return []
        variants = [str(v).strip() for v in parsed if str(v).strip()]
        return variants[:n]
    except Exception as exc:
        _log.warning("query_rewrite_failed", error=str(exc))
        return []
