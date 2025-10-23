from os import getenv

from dotenv import load_dotenv
from langchain_openai import ChatOpenAI
from pydantic import BaseModel, Field

from analyze.prompt import QUERY_ANALYZE_AI_SYSTEM_PROMPT


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

    def __call__(self, query):
        prompt = [("system", QUERY_ANALYZE_AI_SYSTEM_PROMPT.format(query=query))]
        response = self.structured_llm.invoke(prompt)
        return response


if __name__ == "__main__":
    load_dotenv(verbose=True)
    ai = QueryAnalyzeAI(
        ChatOpenAI(
            model="z-ai/glm-4.5-air:free",
            openai_api_key=getenv("OPENROUTER_API_KEY"),
            openai_api_base="https://openrouter.ai/api/v1",
        )
    )
    print(ai("相対性理論について、論理的で体系的にまとめなさい"))
