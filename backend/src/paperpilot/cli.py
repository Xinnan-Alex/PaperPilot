import argparse
import asyncio

from paperpilot.chunk import chunk_pages
from paperpilot.db import get_db
from paperpilot.embed import embed_documents, embed_query
from paperpilot.ingest import extract_text
from paperpilot.store import insert_chunks, insert_document, search_vectors, update_document_status


async def do_ingest(args: argparse.Namespace):
    pages = extract_text(args.file)
    print(f"Extracted {len(pages)} pages")
    chunks = chunk_pages(pages)
    print(f"Split into {len(chunks)} chunks")

    texts = [c.text for c in chunks]
    embeddings = embed_documents(texts)
    for chunk, embedding in zip(chunks, embeddings):
        chunk.embedding = embedding

    async for session in get_db():
        doc_id = await insert_document(session, args.user_id, args.file, f"cli/{args.file}")
        await insert_chunks(session, args.user_id, doc_id, chunks)
        await update_document_status(session, doc_id, "ready")
        print(f"Ingested document {doc_id} with {len(chunks)} chunks")


async def do_ask(args: argparse.Namespace):
    query_embedding = embed_query(args.query)

    async for session in get_db():
        doc_ids = args.doc_ids if args.doc_ids else None
        results = await search_vectors(
            session, args.user_id, query_embedding, k=args.k, doc_ids=doc_ids
        )

    for i, row in enumerate(results, 1):
        print(f"\n--- Result {i} (distance={row['distance']:.4f}) ---")
        print(f"  File:     {row['filename']}")
        print(f"  Page:     {row['page']}")
        print(f"  Chunk:    {row['ordinal']}")
        print(f"  Text:     {row['text'][:200]}{'...' if len(row['text']) > 200 else ''}")


def main():
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="command")

    ingest_p = sub.add_parser("ingest")
    ingest_p.add_argument("file")
    ingest_p.add_argument("--user-id", required=True)

    ask_p = sub.add_parser("ask")
    ask_p.add_argument("query")
    ask_p.add_argument("--user-id", required=True)
    ask_p.add_argument("--k", type=int, default=5, help="Number of results to return")
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
