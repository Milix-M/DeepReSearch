import pytest

from src.backend.tools import web_research as web_research_module


class DummyDDGS:
    def __init__(self):
        self.calls = []

    def text(self, query, region, safesearch, backend):
        self.calls.append((query, region, safesearch, backend))
        results = [
            {"title": "title", "body": "body", "href": "url"},
            {"href": "only"},
        ]
        for item in results:
            yield item


@pytest.fixture(autouse=True)
def patch_ddgs(monkeypatch: pytest.MonkeyPatch):
    dummy = DummyDDGS()

    def factory():
        return dummy

    monkeypatch.setattr(web_research_module, "DDGS", factory)
    return dummy


def test_web_research_collects_results(patch_ddgs):
    """web_research ツールが DuckDuckGo からの結果を整形して収集することを検証するテスト。

    Args:
        patch_ddgs (DummyDDGS): モンキーパッチで差し替えた検索クライアント。
    """
    results = web_research_module.web_research.invoke({"query": "test"})
    assert results[0]["title"] == "title"
    assert results[1]["snippet"] == ""
    assert patch_ddgs.calls[0][0] == "test"
