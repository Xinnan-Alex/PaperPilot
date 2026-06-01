from __future__ import annotations

import argparse
import asyncio

from paperpilot.chunk import chunk_pages
from paperpilot.db import get_db
from paperpilot.embed import embed_documents
from paperpilot.ingest import extract_text
from paperpilot.reader import answer
from paperpilot.store import insert_chunks, insert_document, update_document_status


async def do_ingest(args: argparse.Namespace) -> None:
    pages = extract_text(args.file)
    print(f"Extracted {len(pages)} pages")
    chunks = chunk_pages(pages)
    print(f"Split into {len(chunks)} chunks")

    texts: list[str] = [c.text for c in chunks]
    embeddings: list[list[float]] = embed_documents(texts)
    for chunk, embedding in zip(chunks, embeddings):
        chunk.embedding = embedding

    async for session in get_db():
        doc_id: str = await insert_document(session, args.user_id, args.file, f"cli/{args.file}")
        await insert_chunks(session, args.user_id, doc_id, chunks)
        await update_document_status(session, doc_id, "ready")
        print(f"Ingested document {doc_id} with {len(chunks)} chunks")


async def do_ask(args: argparse.Namespace) -> None:
    async for event in answer(args.query, args.user_id, top_k=args.k, doc_ids=args.doc_ids):
        if event.startswith("event: token"):
            import json

            data = event.removeprefix("event: token\ndata: ").rstrip("\n")
            print(json.loads(data), end="", flush=True)
        elif event.startswith("event: sources"):
            print("\n\n--- Sources ---")
            import json

            data = event.removeprefix("event: sources\ndata: ").rstrip("\n")
            sources = json.loads(data)
            for s in sources:
                print(f"  [{s['ordinal']}] {s['document_filename']} (p.{s.get('page', '?')})")
        elif event.startswith("event: confidence"):
            data = event.removeprefix("event: confidence\ndata: ").rstrip("\n")
            print(f"\n\nConfidence: {data}")
        elif event.startswith("event: done"):
            pass


def main() -> None:
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="command")

    ingest_p = sub.add_parser("ingest")
    ingest_p.add_argument("file")
    ingest_p.add_argument("--user-id", required=True)

    ask_p = sub.add_parser("ask")
    ask_p.add_argument("query")
    ask_p.add_argument("--user-id", required=True)
    ask_p.add_argument("--k", type=int, default=5, help="Number of chunks to retrieve")
    ask_p.add_argument("--doc-ids", nargs="+", help="Restrict search to these document IDs")

    args = parser.parse_args()

    if args.command == "ingest":
        asyncio.run(do_ingest(args))
    elif args.command == "ask":
        asyncio.run(do_ask(args))
    else:
        parser.print_help()


if __name__ == "__main__":
    main()
