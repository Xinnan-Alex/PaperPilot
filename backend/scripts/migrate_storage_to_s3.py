"""One-off: copy every existing document object from Supabase Storage to S3.

Reuses the app's own storage backends so the key layout (``<user_id>/<uuid>.<ext>``)
is byte-for-byte identical. Idempotent — re-running skips objects already in S3.

Run from ``backend/`` with BOTH sets of creds present in the environment/.env:
  - Supabase:  SUPABASE_URL, SUPABASE_SECRET_KEY, SUPABASE_STORAGE_BUCKET, SUPABASE_DB_URL
  - AWS/S3:    S3_BUCKET, AWS_REGION, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY

  uv run python -m scripts.migrate_storage_to_s3            # do it
  uv run python -m scripts.migrate_storage_to_s3 --dry-run # list only, copy nothing

STORAGE_BACKEND is ignored here — both backends are instantiated explicitly.
"""

from __future__ import annotations

import asyncio
import mimetypes
import sys

from botocore.exceptions import ClientError
from sqlalchemy import text

from paperpilot.db import async_session
from paperpilot.storage import S3Storage, StorageError, SupabaseStorage


async def _all_keys() -> list[str]:
    async with async_session() as session:
        result = await session.execute(text("SELECT storage_path FROM documents"))
        return [row[0] for row in result.fetchall() if row[0]]


def _exists_in_s3(s3: S3Storage, key: str) -> bool:
    try:
        s3._client.head_object(Bucket=s3._bucket, Key=key)
        return True
    except ClientError as exc:
        if exc.response.get("ResponseMetadata", {}).get("HTTPStatusCode") == 404:
            return False
        raise


async def main(dry_run: bool) -> int:
    src = SupabaseStorage()
    dst = S3Storage()

    keys = await _all_keys()
    print(f"{len(keys)} document object(s) in DB → bucket '{dst._bucket}'")

    copied = skipped = failed = 0
    for key in keys:
        if _exists_in_s3(dst, key):
            print(f"  skip   {key}  (already in S3)")
            skipped += 1
            continue
        if dry_run:
            print(f"  would copy {key}")
            continue
        try:
            data = await src.download(key)
            content_type = mimetypes.guess_type(key)[0] or "application/octet-stream"
            await dst.upload(key, data, content_type)
            print(f"  copied {key}  ({len(data)} bytes)")
            copied += 1
        except StorageError as exc:
            print(f"  FAIL   {key}  status={exc.status} {exc.body[:120]}")
            failed += 1

    print(f"\ndone: copied={copied} skipped={skipped} failed={failed}")
    return 1 if failed else 0


if __name__ == "__main__":
    dry = "--dry-run" in sys.argv
    raise SystemExit(asyncio.run(main(dry)))
