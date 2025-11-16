import asyncio
import datetime
from os import getenv
from typing import Annotated

import langgraph.checkpoint.serde.jsonplus as jsonplus
import nest_asyncio
from langchain_core.load.load import DEFAULT_NAMESPACES, Reviver
from langchain_core.runnables import RunnableConfig
from langchain_openai import ChatOpenAI


if "src" not in DEFAULT_NAMESPACES:
    DEFAULT_NAMESPACES.append("src")
from langchain.agents import create_agent
from langchain_tavily import TavilySearch
from langgraph.checkpoint.memory import MemorySaver
from langgraph.checkpoint.serde.jsonplus import InvalidModuleError, JsonPlusSerializer
from langgraph.graph import END, START, StateGraph
from langgraph.graph.message import add_messages
from langgraph.types import interrupt
from pydantic import BaseModel, Field, model_validator

from backend.ai.search.schema import ResearchReport
from src.backend.ai.analyze.query_analyze import QueryAnalyzeAI, ResearchParameters
from src.backend.ai.reflect.reflect_search_result import ReflectionResultSchema
from src.backend.ai.schedule.plan_reserch import GeneratedObjectSchema, PlanResearchAI
from src.backend.ai.search.prompt import DEEP_RESEARCH_SYSTEM_PROMPT
from src.backend.tools.search_reflect import reflect_on_results


class NamespaceAwareJsonPlusSerializer(JsonPlusSerializer):
    """LangChain の Reviver にカスタム namespace 設定を行うシリアライザ。"""

    def __init__(self, valid_namespaces: list[str], **kwargs) -> None:
        """シリアライザを初期化する。

        Args:
            valid_namespaces (list[str]): 許可する namespace のリスト。
            **kwargs: 親クラスに渡す追加キーワード引数。
        """
        super().__init__(**kwargs)
        self._reviver_with_ns = Reviver(valid_namespaces=valid_namespaces)

    def _reviver(self, value):
        """LangChain 形式の JSON を復元する。

        Args:
            value (dict): 復元対象の JSON データ。

        Returns:
            Any: 復元後の Python オブジェクト。
        """
        if self._allowed_modules and (
            value.get("lc") == 2
            and value.get("type") == "constructor"
            and value.get("id") is not None
        ):
            try:
                return self._revive_lc2(value)
            except InvalidModuleError as exc:
                jsonplus.logger.warning(
                    "Object %s is not in the deserialization allowlist.\n%s",
                    value.get("id"),
                    exc.message,
                )

        return self._reviver_with_ns(value)


class State(BaseModel):
    """ワークフロー全体で共有されるステートモデル。

    Attributes:
        user_input (str | None): ユーザーが入力したクエリ文字列。
        research_parameters (ResearchParameters | None): クエリ解析で得られた研究パラメータ。
        research_plan (GeneratedObjectSchema | None): 研究計画の構造化オブジェクト。
        analysys (ReflectionResultSchema | None): 検索結果の反映・解析結果。
        report (str | None): 最終レポート本文。
        research_plan_human_edit (bool | None): 研究計画を人間が編集するかどうか。
    """

    user_input: str | None = Field()
    research_parameters: ResearchParameters | None = Field(default=None)
    research_plan: GeneratedObjectSchema | None = Field(default=None)
    analysys: ReflectionResultSchema | None = Field(default=None)
    research_plan_human_edit: bool | None = Field(default=None)
    messages: Annotated[list, add_messages] = Field(default=[])
    report: str | None = Field(default=None)

    @model_validator(mode="before")
    @classmethod
    def _ensure_model_instances(cls, values: dict) -> dict:
        """チェックポイント復元時に古いインスタンスを現在のモデルへ再検証する。"""

        research_params = values.get("research_parameters")
        if research_params is not None and not isinstance(
            research_params, ResearchParameters
        ):
            if hasattr(research_params, "model_dump"):
                values["research_parameters"] = ResearchParameters.model_validate(
                    research_params.model_dump()
                )
            elif isinstance(research_params, dict):
                values["research_parameters"] = ResearchParameters.model_validate(
                    research_params
                )

        research_plan = values.get("research_plan")
        if research_plan is not None and not isinstance(
            research_plan, GeneratedObjectSchema
        ):
            if hasattr(research_plan, "model_dump"):
                values["research_plan"] = GeneratedObjectSchema.model_validate(
                    research_plan.model_dump()
                )
            elif isinstance(research_plan, dict):
                values["research_plan"] = GeneratedObjectSchema.model_validate(
                    research_plan
                )

        return values


class OSSDeepResearchAgent:
    """Deep Research の各ノードを束ねるエージェント。"""

    def __init__(self) -> None:
        """エージェントを初期化する。"""
        tavily_search = TavilySearch(
            max_results=10, topic="general", include_answer=True
        )

        # 使用するツール
        self.tools = [tavily_search, reflect_on_results]

        self.llm = ChatOpenAI(
            model="tngtech/deepseek-r1t2-chimera:free",
            openai_api_key=getenv("OPENROUTER_API_KEY"),  # type: ignore[call-arg]
            openai_api_base="https://openrouter.ai/api/v1",  # type: ignore[call-arg]
        )
        self.tool_callable_llm = ChatOpenAI(
            model="z-ai/glm-4.5-air:free",
            openai_api_key=getenv("OPENROUTER_API_KEY"),  # type: ignore[call-arg]
            openai_api_base="https://openrouter.ai/api/v1",  # type: ignore[call-arg]
        )

        # uvloop が利用されている場合は nest_asyncio が未対応のため適用をスキップ。
        loop = None
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            try:
                loop = asyncio.get_event_loop()
            except RuntimeError:
                loop = None

        should_patch = True
        if loop and getattr(loop.__class__, "__module__", "").startswith("uvloop"):
            should_patch = False

        if should_patch:
            try:
                nest_asyncio.apply(loop)
            except ValueError:
                pass

    async def _node_generate_research_parameters(
        self, state: State, config: RunnableConfig
    ) -> dict[str, ResearchParameters]:
        """研究パラメータ生成ノードを実行する。

        Args:
            state (State): 現在のステート。
            config (RunnableConfig): LangGraph実行時の設定。

        Returns:
            dict[str, ResearchParameters]: 生成した研究パラメータを含む差分ステート。
        """
        ai = QueryAnalyzeAI(self.llm)
        response = await ai(state.user_input)
        return {"research_parameters": response}

    async def _node_make_research_plan(
        self, state: State, config: RunnableConfig
    ) -> dict[str, GeneratedObjectSchema]:
        """研究計画生成ノードを実行する。

        Args:
            state (State): 現在のステート。
            config (RunnableConfig): LangGraph実行時の設定。

        Returns:
            dict[str, GeneratedObjectSchema]: 研究計画を含む差分ステート。
        """
        ai = PlanResearchAI(self.tool_callable_llm)
        response = await ai(state.user_input)
        return {"research_plan": response}

    async def _research_plan_human_judge(self, state: State, config: RunnableConfig):
        """研究計画の人手編集要否を判定する。

        Args:
            state (State): 現在のステート。
            config (RunnableConfig): LangGraph実行時の設定。

        Returns:
            State: 判定結果を反映したステート。
        """
        feedback = interrupt("調査計画を編集しますか？")
        if feedback == "y":
            state.research_plan_human_edit = True

        elif feedback == "n":
            state.research_plan_human_edit = False
        return state

    def _node_edit_research_plan(self, state: State):
        """ユーザー編集後の研究計画を検証・正規化する。

        Args:
            state (State): ユーザー編集済みのステート。

        Returns:
            dict[str, GeneratedObjectSchema]: 検証済み研究計画を含む差分ステート。
        """
        plan = state.research_plan
        if plan is None:
            return {}

        if isinstance(plan, GeneratedObjectSchema):
            validated_plan = plan
        elif hasattr(plan, "model_dump"):
            validated_plan = GeneratedObjectSchema.model_validate(plan.model_dump())
        else:
            validated_plan = GeneratedObjectSchema.model_validate(plan)

        return {"research_plan": validated_plan}

    async def _node_deep_research(self, state: State, config: RunnableConfig):
        """ReAct ループを用いた深堀り検索を実行する。

        Args:
            state (State): 現在のステート。
            config (RunnableConfig): LangGraph実行時の設定。

        Returns:
            dict[str, list]: LLM 応答を追記したメッセージ差分。
        """
        query = state.user_input
        plan = state.research_plan
        params = state.research_parameters

        formatted_system_prompt = DEEP_RESEARCH_SYSTEM_PROMPT.format(
            SEARCH_QUERIES_PER_SECTION=params.search_queries_per_section,
            SEARCH_API="Tavily",
            SEARCH_ITERATIONS=params.search_iterations,
            SEARCH_PLAN=plan.model_dump(),
            CURRENT_DATE=datetime.date.today(),
        )

        deepresearch_agent = create_agent(
            model=self.tool_callable_llm,
            tools=self.tools,
            system_prompt=formatted_system_prompt,
            response_format=ResearchReport,
        )

        response = await deepresearch_agent.ainvoke(
            {"messages": [{"role": "user", "content": query}]}
        )

        return response

    def _routing_human_edit_judge(self, state: State):
        """人手編集フラグに基づき次ノードを決定する。

        Args:
            state (State): 判定対象のステート。

        Returns:
            str: 次に実行するノード名。
        """
        if state.research_plan_human_edit:
            return "edit"
        else:
            return "search"

    def _node_write_research_result(self, state: State):
        """LLM 応答から最終レポート本文を抽出する。

        Args:
            state (State): 最終メッセージが格納されたステート。

        Returns:
            dict[str, str | None]: レポート本文を含む差分ステート。
        """
        report_text = None

        if state.messages:
            last_message = state.messages[-1]
            content = getattr(last_message, "content", None)

            if isinstance(content, str):
                report_text = content
            elif isinstance(content, list):
                text_fragments: list[str] = []
                for item in content:
                    if isinstance(item, dict):
                        if "text" in item and isinstance(item["text"], str):
                            text_fragments.append(item["text"])
                        elif "type" in item and item.get("type") == "text":
                            value = item.get("text") or item.get("value")
                            if isinstance(value, str):
                                text_fragments.append(value)
                        else:
                            text_fragments.append(str(item))
                    elif isinstance(item, str):
                        text_fragments.append(item)
                if text_fragments:
                    report_text = "\n\n".join(text_fragments)

        return {"report": report_text}

    def get_compiled_graph(self):
        """LangGraph のステートマシンを構築して返す。

        Returns:
            StateGraph: コンパイル済みの LangGraph。
        """
        graph = StateGraph(State)

        # Node追加
        graph.add_node(self._node_generate_research_parameters)
        graph.add_node(self._node_make_research_plan)
        graph.add_node(self._research_plan_human_judge)
        graph.add_node(self._node_edit_research_plan)
        graph.add_node(self._node_deep_research)
        graph.add_node(self._node_write_research_result)

        # エッジ追加
        graph.add_edge(START, "_node_generate_research_parameters")
        graph.add_edge("_node_generate_research_parameters", "_node_make_research_plan")
        graph.add_edge("_node_make_research_plan", "_research_plan_human_judge")
        graph.add_conditional_edges(
            "_research_plan_human_judge",
            self._routing_human_edit_judge,
            {
                "edit": "_node_edit_research_plan",
                "search": "_node_deep_research",
            },
        )
        graph.add_edge("_node_edit_research_plan", "_node_deep_research")
        graph.add_edge("_node_deep_research", "_node_write_research_result")
        graph.add_edge("_node_write_research_result", END)

        memory = MemorySaver(
            serde=NamespaceAwareJsonPlusSerializer(valid_namespaces=["src"])
        )
        compiled_graph = graph.compile(checkpointer=memory)

        # graph実行イメージ保存
        graph_image = compiled_graph.get_graph().draw_mermaid_png()  # pragma: no cover
        with open("./graph.png", "wb") as file:  # pragma: no cover
            file.write(graph_image)  # pragma: no cover
        return compiled_graph  # pragma: no cover
