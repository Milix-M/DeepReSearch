from pydantic import BaseModel, Field

from .prompt import QUERY_ANALYZE_AI_SYSTEM_PROMPT


class ResearchParameters(BaseModel):
    """クエリに対する研究実行パラメータを表す構造化モデル。

    Attributes:
        search_queries_per_section (int): 各セクションで生成する検索クエリの数。
            値の範囲は 1〜5。
        search_iterations (int): 各クエリに対して実行する検索反復の回数。
            値の範囲は 1〜5。
        reasoning (str): モデルがこれらのパラメータを選択した理由の説明。
    """

    search_queries_per_section: int = Field(
        ge=1,
        le=5,
        description="各セクションで実行する検索クエリの数",
    )
    search_iterations: int = Field(
        ge=1,
        le=5,
        description="各クエリに対して実行する検索反復の回数",
    )
    reasoning: str = Field(description="パラメータ選択の理由")


class QueryAnalyzeAI:
    """LLM に対してResearchParametersを要求するためのラッパークラス

    Attributes:
        llm: LLM クライアント。`with_structured_output(schema)` を提供し、
            その戻り値が `ainvoke(prompt)` をサポートしていることを期待します。

    Examples:
        >>> analyzer = QueryAnalyzeAI(llm)
        >>> params = await analyzer("文書検索にトランスフォーマーを適用する方法")
    """

    def __init__(self, llm) -> None:
        """LLM クライアントを保持し、構造化出力を設定する

        Args:
            llm: `with_structured_output` をサポートする LLM クライアント

        Returns:
            None
        """

        self.llm = llm
        self.structured_llm = llm.with_structured_output(ResearchParameters)

    async def __call__(self, query):
        """LLMを使用して、クエリに基づいたResearchParametersを出力させる

        Args:
            query (str): パラメータを求めたいクエリ

        Returns:
            ResearchParameters: LLM によって生成され、検証されたパラメータオブジェクト
        """

        prompt = [("system", QUERY_ANALYZE_AI_SYSTEM_PROMPT.format(query=query))]
        response = await self.structured_llm.ainvoke(prompt)
        return response
