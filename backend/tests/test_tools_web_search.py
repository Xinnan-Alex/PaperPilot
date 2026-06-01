from __future__ import annotations

import httpx
import pytest
import respx

from paperpilot import tools
from paperpilot.tools import web_search


@pytest.fixture(autouse=True)
def isolate_registry(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(tools, "REGISTRY", {})


async def test_register_skipped_without_key(
    monkeypatch: pytest.MonkeyPatch, clear_provider_env: None
) -> None:
    web_search.register_tool_if_enabled()
    assert "web_search" not in tools.REGISTRY


async def test_register_when_key_present(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("TAVILY_API_KEY", "tvly-test")
    web_search.register_tool_if_enabled()
    assert "web_search" in tools.REGISTRY


@respx.mock
async def test_web_search_returns_results(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("TAVILY_API_KEY", "tvly-test")
    web_search.register_tool_if_enabled()
    route = respx.post("https://api.tavily.com/search").mock(
        return_value=httpx.Response(
            200,
            json={
                "results": [
                    {
                        "title": "Example",
                        "url": "https://example.com",
                        "content": "snippet content",
                    },
                    {"title": "T2", "url": "https://e2.com", "content": "c2"},
                ]
            },
        )
    )

    ctx = tools.ToolContext(user_id="u", access_token="t", doc_ids=None, db_session=None)
    result = await tools.dispatch("web_search", {"query": "ai", "max_results": 2}, ctx)
    assert route.called
    assert result["results"] == [
        {"title": "Example", "url": "https://example.com", "snippet": "snippet content"},
        {"title": "T2", "url": "https://e2.com", "snippet": "c2"},
    ]


@respx.mock
async def test_web_search_handles_error(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("TAVILY_API_KEY", "tvly-test")
    web_search.register_tool_if_enabled()
    respx.post("https://api.tavily.com/search").mock(
        return_value=httpx.Response(500, text="boom")
    )
    ctx = tools.ToolContext(user_id="u", access_token="t", doc_ids=None, db_session=None)
    result = await tools.dispatch("web_search", {"query": "x"}, ctx)
    assert "error" in result
