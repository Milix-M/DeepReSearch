from os import getenv

from langchain_core.tools import tool
from langchain_openai import ChatOpenAI
from pydantic import BaseModel, Field

from src.backend.ai.reflect.reflect_search_result import (
    SearchResultAnalyzeAndReflectAI,
)


class ReflectInput(BaseModel):
    query: str = Field(description="検索に使用した元のクエリ")
    results: str = Field(description="検索から得られた結果")
    iteration: int = Field(description="現在の検索反復回数")
    total_iterations: int = Field(description="計画された総検索反復回数")


@tool(args_schema=ReflectInput)
def reflect_on_results(query, results, iteration, total_iterations) -> dict:
    """
    検索結果を分析し、次の検索をより効果的にするための洞察を提供する

    Parameters
    ----------
    query : str
        検索に使用した元のクエリ
    results : str
        検索から得られた結果
    iteration : int
        現在の検索反復回数
    total_iterations : int
        計画された総検索反復回数

    Returns
    -------
    dict:
       振り返りの結果
    """
    llm = ChatOpenAI(
        model="tngtech/deepseek-r1t2-chimera:free",
        openai_api_key=getenv("OPENROUTER_API_KEY"),  # type: ignore[call-arg]
        openai_api_base="https://openrouter.ai/api/v1",  # type: ignore[call-arg]
    )
    ai = SearchResultAnalyzeAndReflectAI(llm)
    response = ai(query, results)

    result = {
        "key_insights": response.key_insights,
        "information_gaps": response.information_gaps,
        "contradictions": response.contradictions,
        "improved_queries": response.improved_queries,
        "summary": response.summary,
        "current_iteration": iteration,
        "total_iterations": total_iterations,
    }

    return result
