from langchain_core.load.serializable import Serializable
from pydantic import Field

from .prompt import SEARCH_RESULT_ANALYZE_AND_REFLECTION_SYSTEM_PROMPT


class KeyInsight(Serializable):
    """検索結果から得られた単一の重要な洞察を定義します。"""

    insight: str = Field(description="検索結果から得られた重要な洞察")
    confidence: int = Field(ge=1, le=10, description="この洞察の信頼度（1-10）")
    source_indication: str = Field(description="この洞察の出所に関する手がかり")

    @classmethod
    def is_lc_serializable(cls) -> bool:
        return True


class ImprovedQuery(Serializable):
    """改善提案された単一の検索クエリを定義します。"""

    query: str = Field(description="改善された検索クエリ")
    rationale: str = Field(description="このクエリを提案する理由")

    @classmethod
    def is_lc_serializable(cls) -> bool:
        return True


class ReflectionResultSchema(Serializable):
    """
    検索結果の振り返り（Reflection）によって生成される
    オブジェクト全体のスキーマを定義します。
    """

    key_insights: list[KeyInsight]
    information_gaps: list[str] = Field(
        description="特定された情報のギャップや不足している視点"
    )
    contradictions: list[str] = Field(
        description="検索結果内の矛盾する情報や検証が必要な主張"
    )
    improved_queries: list[ImprovedQuery]
    summary: str = Field(description="振り返りの要約と次のステップへの推奨事項")

    @classmethod
    def is_lc_serializable(cls) -> bool:
        return True


class SearchResultAnalyzeAndReflectAI:
    def __init__(self, llm):
        self.llm = llm
        self.structured_llm = llm.with_structured_output(ReflectionResultSchema)

    def __call__(self, query, result) -> ReflectionResultSchema:
        prompt = [
            (
                "system",
                SEARCH_RESULT_ANALYZE_AND_REFLECTION_SYSTEM_PROMPT.format(
                    query=query, result=result
                ),
            )
        ]
        response = self.structured_llm.invoke(prompt)

        return response
