from pydantic import BaseModel, Field

from .prompt import QUERY_ANALYZE_AI_SYSTEM_PROMPT


class ResearchParameters(BaseModel):
    searchQueriesPerSection: int = Field(
        ge=1,  # min
        le=5,  # max
        description="各セクションで実行する検索クエリの数",
    )
    searchIterations: int = Field(
        ge=1,
        le=5,
        description="各クエリに対して実行する検索反復の回数",
    )
    reasoning: str = Field(description="パラメータ選択の理由")


class QueryAnalyzeAI:
    def __init__(self, llm):
        self.llm = llm
        self.structured_llm = llm.with_structured_output(ResearchParameters)

    async def __call__(self, query):
        prompt = [("system", QUERY_ANALYZE_AI_SYSTEM_PROMPT.format(query=query))]
        response = await self.structured_llm.ainvoke(prompt)
        return response
