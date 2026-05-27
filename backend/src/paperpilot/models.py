from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime

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


class QueryRequest(BaseModel):
    query: str
    top_k: int = 5
    doc_ids: list[str] | None = None


class SourceChunk(BaseModel):
    chunk_id: str
    ordinal: int
    page: int | None
    text: str
    document_filename: str


class IngestRequest(BaseModel):
    doc_id: str


class DocumentOut(BaseModel):
    id: str
    filename: str
    status: str
    created_at: datetime


class FeedbackIn(BaseModel):
    query: str
    answer: str
    rating: int
    retrieved_chunk_ids: list[str]


class FeedbackOut(BaseModel):
    id: str
    created_at: datetime
