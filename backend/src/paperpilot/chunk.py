from __future__ import annotations

import re

from paperpilot.models import Chunk, Page


def chunk_pages(pages: list[Page], size: int = 800, overlap: int = 100) -> list[Chunk]:
    chunks: list[Chunk] = []
    ordinal: int = 0

    for page in pages:
        page_chunks: list[str] = _split_text(page.text, size, overlap)
        for text in page_chunks:
            chunks.append(Chunk(ordinal=ordinal, page=page.page_num, text=text))
            ordinal += 1

    return chunks


def _split_text(text: str, size: int, overlap: int) -> list[str]:
    separators: list[str] = ["\n\n", "\n", ". ", "! ", "? ", "; ", " ", ""]
    return _split_recursive(text, separators, size, overlap)


def _split_recursive(text: str, separators: list[str], size: int, overlap: int) -> list[str]:
    result: list[str] = []
    if len(text) <= size:
        if text.strip():
            result.append(text.strip())
        return result

    sep: str = separators[0]
    remaining_seps: list[str] = separators[1:]

    if sep == "":
        return _naive_split(text, size, overlap)

    splits: list[str] = re.split(f"({re.escape(sep)})", text)
    merged: list[str] = []
    i: int = 0
    while i < len(splits):
        part: str = splits[i]
        if i + 1 < len(splits):
            part += splits[i + 1]
            i += 2
        else:
            i += 1
        merged.append(part)

    current: str = ""
    for segment in merged:
        if len(current) + len(segment) <= size:
            current += segment
        else:
            if current.strip():
                result.append(current.strip()[:size])
            current = segment

    if current.strip():
        result.append(current.strip()[:size])

    final: list[str] = []
    for chunk_text in result:
        if len(chunk_text) > size:
            final.extend(_split_recursive(chunk_text, remaining_seps, size, overlap))
        else:
            final.append(chunk_text)

    if overlap > 0 and len(final) > 1:
        overlapped: list[str] = []
        for i, chunk_text in enumerate(final):
            if i > 0:
                prev_end: str = (
                    final[i - 1][-overlap:] if len(final[i - 1]) >= overlap else final[i - 1]
                )
                chunk_text = prev_end + chunk_text
            overlapped.append(chunk_text)
        return overlapped

    return final


def _naive_split(text: str, size: int, overlap: int) -> list[str]:
    chunks: list[str] = []
    start: int = 0
    while start < len(text):
        end: int = min(start + size, len(text))
        chunks.append(text[start:end].strip())
        start += size - overlap
    return chunks
