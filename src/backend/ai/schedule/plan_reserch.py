from langchain_core.load.serializable import Serializable
from pydantic import Field
from langchain_tavily import TavilySearch
from langchain.agents import create_agent


from .prompt import SCHDULE_AI_SYSTEM_PROMPT

"""研究計画作成用のモジュール。

このモジュールは Pydantic モデル群と、外部 LLM を用いて構造化された研究計画を生成する
`PlanResearchAI` クラスを提供します。

主なエクスポート:
    Section: セクション（タイトル、焦点、主要質問）を表すモデル
    Structure: ドキュメントの導入と結論の概要を表すモデル
    ResearchPlan: 調査目的、セクション、全体構成をまとめたモデル
    GeneratedObjectSchema: 生成結果のトップレベルスキーマ（計画本体と分析）
    PlanResearchAI: LLM をラップして構造化出力を取得するユーティリティ

環境変数:
    OPENROUTER_API_KEY: OpenRouter の API キー（実行時に必要）

Examples:
    from schedule.plan_reserch import PlanResearchAI

    ai = PlanResearchAI(llm)
    result = ai("研究テーマの説明")
"""


class Section(Serializable):
    """研究計画内の単一セクションを表すデータモデル。

    Attributes:
        title (str): セクションのタイトル。
        focus (str): セクションの主な焦点（例: 探究の中心テーマ）。
        key_questions (list[str]): そのセクションで扱うべき主要な質問のリスト。
    """

    title: str = Field(description="セクションのタイトル")
    focus: str = Field(description="このセクションの焦点")
    key_questions: list[str] = Field(description="このセクションで探求すべき主要な質問")

    @classmethod
    def is_lc_serializable(cls) -> bool:
        return True


class Structure(Serializable):
    """ドキュメント全体の導入と結論（要約）を保持するモデル。

    Attributes:
        introduction (str): イントロダクションの短い概要。
        conclusion (str): 結論の短い概要。
    """

    introduction: str = Field(description="イントロダクションの概要")
    conclusion: str = Field(description="結論の概要")

    @classmethod
    def is_lc_serializable(cls) -> bool:
        return True


class ResearchPlan(Serializable):
    """研究計画全体を表すモデル。

    Attributes:
        purpose (str): 調査の目的と範囲の記述。
        sections (list[Section]): 調査を分割したセクション一覧。
        structure (Structure): ドキュメントの導入と結論の要約。
    """

    purpose: str = Field(description="調査の目的と範囲")
    sections: list[Section]
    structure: Structure

    @classmethod
    def is_lc_serializable(cls) -> bool:
        return True


class GeneratedObjectSchema(Serializable):
    """LLM の構造化出力がこのスキーマにマッチすることを期待する。

    Attributes:
        research_plan (ResearchPlan): 生成された研究計画本体。
        meta_analysis (str): 生成された計画に対する分析や推奨事項。
    """

    research_plan: ResearchPlan
    meta_analysis: str = Field(description="計画に関する分析と推奨事項")

    @classmethod
    def is_lc_serializable(cls) -> bool:
        return True


class PlanResearchAI:
    def __init__(self, llm):
        """LLM をラップして、構造化スキーマに従う研究計画を生成する。

        Args:
            llm: LangChain 互換の LLM インスタンス。`with_structured_output` メソッドを持ち、
                Pydantic スキーマを渡すことで構造化された戻り値を得られることを想定する。

        Raises:
            AttributeError: 渡された ``llm`` が ``with_structured_output`` を持たない場合に発生する可能性がある。
        """

        self.llm = llm
        tavily_search = TavilySearch(max_results=10, topic="general")

        self.planning_agent = create_agent(
            model=self.llm,
            tools=[tavily_search],
            system_prompt=SCHDULE_AI_SYSTEM_PROMPT.format(query="{query}"),
            response_format=GeneratedObjectSchema,
        )

    async def __call__(self, query):
        """LLM を呼び出して研究計画を生成する。

        Args:
            query (str): 生成したい研究計画の主題や問い。システムプロンプト内で使用される。

        Returns:
            GeneratedObjectSchema: 生成された研究計画とメタ分析を含む構造化オブジェクト。

        Examples:
            >>> ai = PlanResearchAI(llm)
            >>> result = ai("Googleとは？")
        """

        response = await self.planning_agent.ainvoke(
            {"messages": [{"role": "user", "content": query}]}
        )
        return response["structured_response"]
