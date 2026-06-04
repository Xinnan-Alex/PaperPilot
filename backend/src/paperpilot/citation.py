from __future__ import annotations

import re

_WORD = re.compile(r"[a-z0-9]+")
_SENT_SPLIT = re.compile(r"(?<=[.!?])\s+")
_STOP = frozenset(
    {
        "the", "a", "an", "of", "to", "in", "on", "for", "and", "or", "is",
        "are", "was", "were", "be", "been", "by", "with", "as", "at", "that",
        "this", "it", "from", "how", "did", "do", "does", "what", "which",
        "who", "whom", "whose", "why", "when",
    }
)


def _tokens(s: str) -> set[str]:
    return {w for w in _WORD.findall(s.lower()) if w not in _STOP}


def best_span(text: str, query: str) -> tuple[int, int] | None:
    """Char offsets (start, end) of the sentence in `text` with the highest
    overlap of meaningful query terms. None when inputs are empty or nothing
    overlaps."""
    if not text or not query:
        return None
    q = _tokens(query)
    if not q:
        return None

    best: tuple[int, int] | None = None
    best_score = 0
    pos = 0
    for sentence in _SENT_SPLIT.split(text):
        start = text.find(sentence, pos)
        if start < 0:
            start = pos
        end = start + len(sentence)
        pos = end
        score = len(q & _tokens(sentence))
        if score > best_score:
            best_score = score
            best = (start, end)
    return best
