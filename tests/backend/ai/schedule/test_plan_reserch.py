import os

import pytest

from src.backend.ai.schedule import plan_reserch as plan_module
from src.backend.ai.schedule.plan_reserch import (GeneratedObjectSchema,
                                                  PlanResearchAI, ResearchPlan,
                                                  Section, Structure)

os.environ.setdefault("TAVILY_API_KEY", "test")


@pytest.mark.asyncio
async def test_plan_research_ai_invocation(monkeypatch: pytest.MonkeyPatch):
    """PlanResearchAI が create_agent を通じて構造化レスポンスを取得することを検証するテスト。"""

    class DummyPlanningAgent:
        def __init__(self, response):
            self.response = response
            self.calls: list = []

        async def ainvoke(self, payload):
            self.calls.append(payload)
            return {"structured_response": self.response}

    captured = {}
    dummy_plan = GeneratedObjectSchema(
        research_plan=ResearchPlan(
            purpose="purpose",
            sections=[Section(title="t", focus="f", key_questions=["q"])],
            structure=Structure(introduction="intro", conclusion="outro"),
        ),
        meta_analysis="meta",
    )
    dummy_agent = DummyPlanningAgent(dummy_plan)

    monkeypatch.setattr(plan_module, "TavilySearch", lambda *_, **__: "tavily")

    def fake_create_agent(**kwargs):
        captured.update(kwargs)
        return dummy_agent

    monkeypatch.setattr(plan_module, "create_agent", fake_create_agent)

    llm = object()
    ai = PlanResearchAI(llm)
    result = await ai("題材")

    assert result is dummy_plan
    assert captured["model"] is llm
    assert captured["tools"] == ["tavily"]
    assert dummy_agent.calls[0]["messages"][0]["content"] == "題材"


def test_section_serialization_flags():
    """研究計画に関連する各モデルが LangChain シリアライズ互換であることを検証するテスト。"""
    assert Section.is_lc_serializable()
    assert Structure.is_lc_serializable()
    assert ResearchPlan.is_lc_serializable()
    assert GeneratedObjectSchema.is_lc_serializable()
