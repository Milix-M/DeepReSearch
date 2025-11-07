import pytest

from src.backend.ai.schedule.plan_reserch import (GeneratedObjectSchema,
                                                  PlanResearchAI, ResearchPlan,
                                                  Section, Structure)


class DummyStructured:
    def __init__(self, schema):
        self.schema = schema

    async def ainvoke(self, prompt):
        assert prompt[0][0] == "system"
        plan = ResearchPlan(
            purpose="purpose",
            sections=[Section(title="t", focus="f", key_questions=["q"])],
            structure=Structure(introduction="intro", conclusion="outro"),
        )
        return GeneratedObjectSchema(research_plan=plan, meta_analysis="meta")


class DummyLLM:
    def __init__(self):
        self.schema = None

    def with_structured_output(self, schema):
        self.schema = schema
        return DummyStructured(schema)


@pytest.mark.asyncio
async def test_plan_research_ai_invocation():
    llm = DummyLLM()
    ai = PlanResearchAI(llm)
    result = await ai("題材")

    assert isinstance(result, GeneratedObjectSchema)
    assert llm.schema is GeneratedObjectSchema
    assert result.research_plan.sections[0].title == "t"


def test_section_serialization_flags():
    assert Section.is_lc_serializable()
    assert Structure.is_lc_serializable()
    assert ResearchPlan.is_lc_serializable()
    assert GeneratedObjectSchema.is_lc_serializable()
