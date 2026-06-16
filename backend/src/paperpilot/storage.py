"""Object storage abstraction.

Two interchangeable backends, chosen by ``settings.storage_backend``:

- ``supabase`` — the original Supabase Storage REST API (httpx).
- ``s3`` — Amazon S3 via boto3.

Both keep the same key layout (``<user_id>/<uuid>.<ext>``). The per-user
isolation that Supabase RLS used to enforce on the ``s3`` backend lives in the
*callers*: every key is built server-side from the JWT-verified ``user_id``,
never from client input.

Call sites keep their own logging + HTTP translation; backends only raise
:class:`StorageError` (status + body) so that behaviour is identical across
both implementations.
"""

from __future__ import annotations

import asyncio
from typing import Protocol
from urllib.parse import quote

import httpx

from paperpilot.config import settings
from paperpilot.logging import get_logger


class StorageError(Exception):
    """Raised on a failed storage operation. Mirrors the old httpx status/body."""

    def __init__(self, status: int, body: str) -> None:
        super().__init__(f"storage {status}: {body[:200]}")
        self.status = status
        self.body = body


class StorageBackend(Protocol):
    async def upload(
        self, path: str, data: bytes, content_type: str, access_token: str | None = None
    ) -> None: ...

    async def download(self, path: str) -> bytes: ...

    async def delete(self, path: str) -> None: ...

    async def signed_url(self, path: str, expires_in: int = 300) -> str: ...


class SupabaseStorage:
    """Original behaviour: raw REST calls against Supabase Storage."""

    def _admin_headers(self, content_type: str | None = None) -> dict[str, str]:
        headers: dict[str, str] = {"apikey": settings.supabase_secret_key}
        if content_type:
            headers["Content-Type"] = content_type
        return headers

    def _user_headers(self, access_token: str, content_type: str | None = None) -> dict[str, str]:
        headers: dict[str, str] = {
            "apikey": settings.supabase_publishable_key or settings.supabase_secret_key,
            "Authorization": f"Bearer {access_token}",
        }
        if content_type:
            headers["Content-Type"] = content_type
        return headers

    def _object_url(self, path: str) -> str:
        bucket = settings.supabase_storage_bucket
        return f"{settings.supabase_url}/storage/v1/object/{bucket}/{path}"

    async def upload(
        self, path: str, data: bytes, content_type: str, access_token: str | None = None
    ) -> None:
        # Upload through the user's JWT so Supabase RLS still applies; fall back
        # to the service key if no token (e.g. server-side flows).
        headers = (
            self._user_headers(access_token, content_type)
            if access_token
            else self._admin_headers(content_type)
        )
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(self._object_url(path), content=data, headers=headers)
        if resp.status_code >= 400:
            raise StorageError(resp.status_code, resp.text)

    async def download(self, path: str) -> bytes:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.get(self._object_url(path), headers=self._admin_headers())
        if resp.status_code >= 400:
            raise StorageError(resp.status_code, resp.text)
        return resp.content

    async def delete(self, path: str) -> None:
        encoded = quote(path, safe="/")
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.delete(self._object_url(encoded), headers=self._admin_headers())
        if resp.status_code >= 400:
            raise StorageError(resp.status_code, resp.text)

    async def signed_url(self, path: str, expires_in: int = 300) -> str:
        encoded = quote(path, safe="/")
        bucket = settings.supabase_storage_bucket
        url = f"{settings.supabase_url}/storage/v1/object/sign/{bucket}/{encoded}"
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.post(
                url, headers=self._admin_headers(), json={"expiresIn": expires_in}
            )
        if resp.status_code >= 400:
            raise StorageError(resp.status_code, resp.text)
        signed_path: str = resp.json().get("signedURL", "")
        return f"{settings.supabase_url}/storage/v1{signed_path}"


class S3Storage:
    """Amazon S3 backend. boto3 is sync, so blocking calls run off the event loop."""

    def __init__(self) -> None:
        import boto3

        self._client = boto3.client("s3", region_name=settings.aws_region)
        self._bucket = settings.s3_bucket

    def _wrap(self, exc: Exception) -> StorageError:
        from botocore.exceptions import ClientError

        if isinstance(exc, ClientError):
            status = int(exc.response.get("ResponseMetadata", {}).get("HTTPStatusCode", 502))
            return StorageError(status, str(exc))
        return StorageError(502, str(exc))

    async def upload(
        self, path: str, data: bytes, content_type: str, access_token: str | None = None
    ) -> None:
        # access_token is unused — isolation is enforced by the server-built key.
        try:
            await asyncio.to_thread(
                self._client.put_object,
                Bucket=self._bucket,
                Key=path,
                Body=data,
                ContentType=content_type,
            )
        except Exception as exc:  # noqa: BLE001 — normalised to StorageError
            raise self._wrap(exc) from exc

    async def download(self, path: str) -> bytes:
        try:
            obj = await asyncio.to_thread(self._client.get_object, Bucket=self._bucket, Key=path)
            data: bytes = await asyncio.to_thread(obj["Body"].read)
            return data
        except Exception as exc:  # noqa: BLE001
            raise self._wrap(exc) from exc

    async def delete(self, path: str) -> None:
        try:
            await asyncio.to_thread(self._client.delete_object, Bucket=self._bucket, Key=path)
        except Exception as exc:  # noqa: BLE001
            raise self._wrap(exc) from exc

    async def signed_url(self, path: str, expires_in: int = 300) -> str:
        # Pure signing, no network I/O — safe to call inline.
        try:
            url: str = self._client.generate_presigned_url(
                "get_object",
                Params={"Bucket": self._bucket, "Key": path},
                ExpiresIn=expires_in,
            )
            return url
        except Exception as exc:  # noqa: BLE001
            raise self._wrap(exc) from exc

    async def exists(self, path: str) -> bool:
        from botocore.exceptions import ClientError

        try:
            await asyncio.to_thread(self._client.head_object, Bucket=self._bucket, Key=path)
            return True
        except ClientError as exc:
            if exc.response.get("ResponseMetadata", {}).get("HTTPStatusCode") == 404:
                return False
            raise self._wrap(exc) from exc


class FallbackStorage:
    """Dark-migration wrapper: write+read S3, fall back to Supabase for objects
    not yet backfilled. ponytail: transitional — delete once the backfill is done
    and ``storage_fallback_read`` no longer appears in logs.
    """

    def __init__(self, primary: S3Storage, fallback: SupabaseStorage) -> None:
        self._p = primary
        self._f = fallback

    async def upload(
        self, path: str, data: bytes, content_type: str, access_token: str | None = None
    ) -> None:
        await self._p.upload(path, data, content_type, access_token)

    async def download(self, path: str) -> bytes:
        try:
            return await self._p.download(path)
        except StorageError as exc:
            if exc.status != 404:
                raise
            get_logger().info("storage_fallback_read", path=path)
            return await self._f.download(path)

    async def delete(self, path: str) -> None:
        # Object may live in either store mid-migration — best-effort both.
        for backend in (self._p, self._f):
            try:
                await backend.delete(path)
            except StorageError:
                pass

    async def signed_url(self, path: str, expires_in: int = 300) -> str:
        if await self._p.exists(path):
            return await self._p.signed_url(path, expires_in)
        get_logger().info("storage_fallback_signed_url", path=path)
        return await self._f.signed_url(path, expires_in)


_backend: StorageBackend | None = None


def get_storage() -> StorageBackend:
    """Return the configured storage backend (cached)."""
    global _backend
    if _backend is None:
        if settings.storage_backend == "s3" and settings.storage_fallback == "supabase":
            _backend = FallbackStorage(S3Storage(), SupabaseStorage())
        elif settings.storage_backend == "s3":
            _backend = S3Storage()
        else:
            _backend = SupabaseStorage()
    return _backend
