from types import SimpleNamespace

import pytest

from src.backend.tools import search_reflect


class DummyChat:
    def __init__(self, **kwargs):
        self.kwargs = kwargs


class DummyReflectAI:
    def __init__(self, _llm):
        self.calls = []

    def __call__(self, query, results):
        self.calls.append((query, results))
        return SimpleNamespace(
            key_insights=["insight"],
            information_gaps=["gap"],
            contradictions=["contra"],
            improved_queries=["better"],
            summary="summary",
        )


@pytest.fixture(autouse=True)
def patch_dependencies(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(search_reflect, "ChatOpenAI", DummyChat)
    monkeypatch.setattr(
        search_reflect, "SearchResultAnalyzeAndReflectAI", DummyReflectAI
    )


def test_reflect_on_results_returns_augmented_payload():
    payload = search_reflect.reflect_on_results.invoke(
        {
            "query": "q",
            "results": "r",
            "iteration": 1,
            "total_iterations": 3,
        }
    )
    assert payload["key_insights"] == ["insight"]
    assert payload["current_iteration"] == 1
    assert payload["total_iterations"] == 3
