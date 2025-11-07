import asyncio
from os import getenv

from langchain_core.runnables import RunnableConfig
from langchain_openai import ChatOpenAI
from langgraph.checkpoint.memory import MemorySaver
from langgraph.graph import END, START, StateGraph
from langgraph.types import interrupt
from pydantic import BaseModel, Field

from src.ai.analyze.query_analyze import QueryAnalyzeAI, ResearchParameters
from src.ai.reflect.reflect_search_result import ReflectionResultSchema
from src.ai.schedule.plan_reserch import GeneratedObjectSchema, PlanResearchAI


class State(BaseModel):
    user_input: str | None = Field()
    research_parameters: ResearchParameters | None = Field(default=None)
    research_plan: GeneratedObjectSchema | None = Field(default=None)
    analysys: ReflectionResultSchema | None = Field(default=None)
    report: str | None = Field(default=None)
    research_plan_human_edit: bool | None = Field(default=None)


def _research_plan_human_judge(state: State, config: RunnableConfig):
    feedback = interrupt("編集しますか？ y or n: ")
    if feedback == "y":
        state.research_plan_human_edit = True

    elif feedback == "n":
        state.research_plan_human_edit = False
    return state


async def node_generate_research_parameters(
    state: State, config: RunnableConfig
) -> dict[str, ResearchParameters]:
    ai = QueryAnalyzeAI(
        ChatOpenAI(
            model="z-ai/glm-4.5-air:free",
            openai_api_key=getenv("OPENROUTER_API_KEY"),
            openai_api_base="https://openrouter.ai/api/v1",
        )
    )
    response = await ai(state.user_input)
    state.research_parameters = response
    return {"research_parameters": response}


def node_make_research_plan(state: State, config: RunnableConfig):
    ai = PlanResearchAI(
        ChatOpenAI(
            model="z-ai/glm-4.5-air:free",
            openai_api_key=getenv("OPENROUTER_API_KEY"),
            openai_api_base="https://openrouter.ai/api/v1",
        )
    )
    response = ai(state.user_input)
    state.research_plan = response
    print(state)
    return state


def node_web_search(state: State, config: RunnableConfig):
    return


def node_analyze_research_result_and_reflect(state: State, config: RunnableConfig):
    return


def node_make_report(state: State, config: RunnableConfig):
    return


def routing_human_edit_judge(state: State):
    if state.research_plan_human_edit:
        return "edit"
    else:
        return "search"


def node_edit_research_plan(state: State):
    return


async def main():
    graph = StateGraph(State)
    graph.add_node(node_generate_research_parameters)
    graph.add_node(node_make_research_plan)
    graph.add_node(_research_plan_human_judge)
    graph.add_node(node_edit_research_plan)
    graph.add_node(node_web_search)
    graph.add_node(node_analyze_research_result_and_reflect)
    graph.add_node(node_make_report)
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
    inputs = {"user_input": "東條英機について調査"}
    # compiled_graph.stream(inputs, config=config, stream_mode="values", debug=True)

    async for msg, metadata in compiled_graph.astream(
        inputs,
        config=config,
        stream_mode="messages",
        debug=True,
    ):
        if msg.content:
            print(msg.content, end="|", flush=True)


if __name__ == "__main__":
    asyncio.run(main())
