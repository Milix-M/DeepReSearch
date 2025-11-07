import pytest

from src.backend.ai.analyze.query_analyze import (QueryAnalyzeAI,
                                                  ResearchParameters)


class DummyStructured:
    def __init__(self, schema):
        self.schema = schema
        self.invocations: list = []

    async def ainvoke(self, prompt):
        self.invocations.append(prompt)
        assert prompt[0][0] == "system"
        return self.schema(
            search_queries_per_section=2,
            search_iterations=3,
            reasoning="reason",
        )


class DummyLLM:
    def __init__(self):
        self.structured_schema = None

    def with_structured_output(self, schema):
        self.structured_schema = schema
        return DummyStructured(schema)


@pytest.mark.asyncio
async def test_query_analyze_ai_invokes_llm():
    llm = DummyLLM()
    ai = QueryAnalyzeAI(llm)
    params = await ai("質問")

    assert isinstance(params, ResearchParameters)
    assert llm.structured_schema is ResearchParameters
    assert params.search_queries_per_section == 2


def test_research_parameters_validation():
    with pytest.raises(ValueError):
        ResearchParameters(
            search_queries_per_section=0,
            search_iterations=1,
            reasoning="x",
        )

    instance = ResearchParameters(
        search_queries_per_section=1,
        search_iterations=5,
        reasoning="ok",
    )
    assert instance.is_lc_serializable()
