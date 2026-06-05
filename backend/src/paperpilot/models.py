from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


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
    query: str = Field(min_length=1, max_length=2000)
    top_k: int = Field(default=5, ge=1, le=20)
    doc_ids: list[str] | None = None


class SourceChunk(BaseModel):
    chunk_id: str
    document_id: str
    ordinal: int
    page: int | None
    text: str
    document_filename: str
    source_url: str


class IngestRequest(BaseModel):
    doc_id: str


class DocumentOut(BaseModel):
    id: str
    filename: str
    status: str
    stage: str | None = None
    error_detail: str | None = None
    retry_count: int = 0
    created_at: datetime


class FeedbackIn(BaseModel):
    query: str = Field(min_length=1)
    answer: str = Field(min_length=1)
    rating: Literal[1, -1]  # 1 (thumbs up) or -1 (thumbs down)
    retrieved_chunk_ids: list[str]


class FeedbackOut(BaseModel):
    id: str
    created_at: datetime


class ChatMessageIn(BaseModel):
    role: str
    content: str


class ChatRequest(BaseModel):
    session_id: str | None = None
    messages: list[ChatMessageIn]
    model_id: str
    doc_ids: list[str] | None = None
    top_k: int = Field(default=5, ge=1, le=20)
