from src.backend.ai.reflect import reflect_search_result as module
from src.backend.ai.reflect.reflect_search_result import (
    ImprovedQuery,
    KeyInsight,
    ReflectionResultSchema,
    SearchResultAnalyzeAndReflectAI,
)


class DummyStructured:
    def __init__(self, schema):
        self.schema = schema
        self.calls = []

    def invoke(self, prompt):
        self.calls.append(prompt)
        return schema_instance()


def schema_instance() -> ReflectionResultSchema:
    return ReflectionResultSchema(
        key_insights=[
            KeyInsight(insight="情報", confidence=7, source_indication="link"),
        ],
        information_gaps=["gap"],
        contradictions=["contradiction"],
        improved_queries=[
            ImprovedQuery(query="better", rationale="because"),
        ],
        summary="summary",
    )


class DummyLLM:
    def __init__(self):
        self.schema = None

    def with_structured_output(self, schema):
        self.schema = schema
        return DummyStructured(schema)


def test_structures_are_lc_serializable():
    assert KeyInsight.is_lc_serializable()
    assert ImprovedQuery.is_lc_serializable()
    assert ReflectionResultSchema.is_lc_serializable()


def test_reflection_ai_invokes_structured_llm(monkeypatch):
    llm = DummyLLM()
    monkeypatch.setattr(
        module,
        "SEARCH_RESULT_ANALYZE_AND_REFLECTION_SYSTEM_PROMPT",
        "{result}",
    )
    ai = SearchResultAnalyzeAndReflectAI(llm)
    result = ai("query", "result")

    assert isinstance(result, ReflectionResultSchema)
    assert llm.schema is ReflectionResultSchema
    assert result.key_insights[0].confidence == 7
