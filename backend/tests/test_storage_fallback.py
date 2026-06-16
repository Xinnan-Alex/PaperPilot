from paperpilot.storage import FallbackStorage, StorageError


class FakeS3:
    def __init__(self) -> None:
        self.objs: dict[str, bytes] = {}

    async def upload(self, p, d, ct, access_token=None):  # type: ignore[no-untyped-def]
        self.objs[p] = d

    async def download(self, p):  # type: ignore[no-untyped-def]
        if p in self.objs:
            return self.objs[p]
        raise StorageError(404, "missing")

    async def delete(self, p):  # type: ignore[no-untyped-def]
        self.objs.pop(p, None)

    async def signed_url(self, p, expires_in=300):  # type: ignore[no-untyped-def]
        return f"s3://{p}"

    async def exists(self, p):  # type: ignore[no-untyped-def]
        return p in self.objs


class FakeSupa(FakeS3):
    async def signed_url(self, p, expires_in=300):  # type: ignore[no-untyped-def]
        return f"supa://{p}"


async def test_old_object_reads_from_supabase() -> None:
    supa = FakeSupa()
    supa.objs["old"] = b"X"
    fb = FallbackStorage(FakeS3(), supa)  # type: ignore[arg-type]
    assert await fb.download("old") == b"X"  # missing in S3 → falls back
    assert await fb.signed_url("old") == "supa://old"


async def test_uploaded_object_reads_from_s3() -> None:
    fb = FallbackStorage(FakeS3(), FakeSupa())  # type: ignore[arg-type]
    await fb.upload("new", b"Y", "text/plain")
    assert await fb.download("new") == b"Y"  # S3 hit, no fallback
    assert await fb.signed_url("new") == "s3://new"
