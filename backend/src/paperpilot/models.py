from __future__ import annotations

from dataclasses import dataclass

from pydantic import BaseModel


class MeResponse(BaseModel):
    user_id: str
    email: str | None


@dataclass
class Page:
    page_num: int
    text: str


@dataclass
class Chunk:
    ordinal: int
    page: int | None
    text: str
    embedding: list[float] | None = None