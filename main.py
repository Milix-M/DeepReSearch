import asyncio
from os import getenv

from langchain_core.runnables import RunnableConfig
from langchain_openai import ChatOpenAI
from langgraph.checkpoint.memory import MemorySaver
from langgraph.graph import END, START, StateGraph
from langgraph.types import Command, interrupt
from pydantic import BaseModel, Field

from src.ai.analyze.query_analyze import QueryAnalyzeAI, ResearchParameters
from src.ai.reflect.reflect_search_result import ReflectionResultSchema
from src.ai.schedule.plan_reserch import GeneratedObjectSchema, PlanResearchAI

llm = ChatOpenAI(
    model="z-ai/glm-4.5-air:free",
    openai_api_key=getenv("OPENROUTER_API_KEY"),
    openai_api_base="https://openrouter.ai/api/v1",
)


class State(BaseModel):
    """ワークフローで共有されるState

    Attributes:
        user_input (str | None): ユーザーが入力したクエリ文字列
        research_parameters (ResearchParameters | None): クエリ解析により生成された研究パラメータ
        research_plan (GeneratedObjectSchema | None): 研究計画
        analysys (ReflectionResultSchema | None): 検索結果の解析・反映結果
        report (str | None): 最終的なリポート本文
        research_plan_human_edit (bool | None): 研究計画を人間が編集するかどうかのフラグ
    """

    user_input: str | None = Field()
    research_parameters: ResearchParameters | None = Field(default=None)
    research_plan: GeneratedObjectSchema | None = Field(default=None)
    analysys: ReflectionResultSchema | None = Field(default=None)
    report: str | None = Field(default=None)
    research_plan_human_edit: bool | None = Field(default=None)


async def _research_plan_human_judge(state: State, config: RunnableConfig):
    """研究計画を人間が編集するかどうか判定するノード

    ユーザーに対して「編集しますか？ y or n: 」と尋ね、
    `state.research_plan_human_edit` を True/False に設定して返す。

    Args:
        state (State): 現在のワークフロー状態。`research_plan_human_edit` が更新される

    Returns:
    """
    feedback = interrupt("編集しますか？ y or n: ")
    if feedback == "y":
        state.research_plan_human_edit = True

    elif feedback == "n":
        state.research_plan_human_edit = False
    return state


async def node_generate_research_parameters(
    state: State, config: RunnableConfig
) -> dict[str, ResearchParameters]:
    """ユーザー入力から研究パラメータを生成する非同期ノード

    QueryAnalyzeAI を用いて `state.user_input` を解析し、研究に必要な
    パラメータを生成して辞書形式で返す

    Args:
        state (State): ユーザー入力を含むState

    Returns:
        dict[str, ResearchParameters]: キー 'research_parameters' に解析結果を持つ辞書。
    """
    ai = QueryAnalyzeAI(llm)
    response = await ai(state.user_input)
    return {"research_parameters": response}


async def node_make_research_plan(
    state: State, config: RunnableConfig
) -> dict[str, GeneratedObjectSchema]:
    """研究計画を生成する非同期ノード

    PlanResearchAI を用いて、与えられた入力から研究計画オブジェクトを生成します

    Args:
        state (State): 現在の状態オブジェクト（入力や既存のパラメータを含む）

    Returns:
        dict[str, GeneratedObjectSchema]: キー 'research_plan' に生成された計画を格納した辞書。
    """
    ai = PlanResearchAI(llm)
    response = await ai(state.user_input)
    return {"research_plan": response}


def node_web_search(state: State, config: RunnableConfig):
    return


def node_analyze_research_result_and_reflect(state: State, config: RunnableConfig):
    return


def node_make_report(state: State, config: RunnableConfig):
    return


def routing_human_edit_judge(state: State):
    """人間による編集判定に応じてルーティング先を決定する関数

    Args:
        state (State): `research_plan_human_edit` フラグを参照するState

    Returns:
        str: 'edit'（編集）または 'search'（検索）
    """
    if state.research_plan_human_edit:
        return "edit"
    else:
        return "search"


def node_edit_research_plan(state: State):
    return


async def main():
    graph = StateGraph(State)

    # Node追加
    graph.add_node(node_generate_research_parameters)
    graph.add_node(node_make_research_plan)
    graph.add_node(_research_plan_human_judge)
    graph.add_node(node_edit_research_plan)
    graph.add_node(node_web_search)
    graph.add_node(node_analyze_research_result_and_reflect)
    graph.add_node(node_make_report)

    # Edge追加
    graph.add_edge(START, "node_generate_research_parameters")
    graph.add_edge("node_generate_research_parameters", "node_make_research_plan")
    graph.add_edge("node_make_research_plan", "_research_plan_human_judge")
    graph.add_conditional_edges(
        "_research_plan_human_judge",
        routing_human_edit_judge,
        {
            "edit": "node_edit_research_plan",
            "search": "node_web_search",
        },
    )
    graph.add_edge("node_edit_research_plan", "node_web_search")
    graph.add_edge("node_web_search", "node_analyze_research_result_and_reflect")
    graph.add_edge("node_analyze_research_result_and_reflect", "node_make_report")
    graph.add_edge("node_make_report", END)

    memory = MemorySaver()
    compiled_graph = graph.compile(checkpointer=memory)

    # graph実行イメージ保存
    graph_image = compiled_graph.get_graph().draw_mermaid_png()
    with open("./graph.png", "wb") as file:
        file.write(graph_image)

    config = {"configurable": {"thread_id": "1"}}
    inputs = {"user_input": "AIの進化について調査"}

    # Graph実行
    async for msg in compiled_graph.astream(
        inputs,
        config=config,
        stream_mode="updates",
        debug=True,
    ):
        if msg:
            print(msg)

    print("interrupt中")

    # Graph再実行
    async for msg in compiled_graph.astream(
        Command(resume="y"),
        config=config,
        stream_mode="updates",
        debug=True,
    ):
        if msg:
            print(msg)


if __name__ == "__main__":
    asyncio.run(main())
