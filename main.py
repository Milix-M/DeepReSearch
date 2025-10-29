from langchain_core.runnables import RunnableConfig
from langgraph.graph import END, START, StateGraph
from langgraph.types import interrupt
from pydantic import BaseModel, Field

from src.ai.analyze.query_analyze import ResearchParameters
from src.ai.reflect.reflect_search_result import ReflectionResultSchema
from src.ai.schedule.plan_reserch import GeneratedObjectSchema


class State(BaseModel):
    value: str = Field()
    research_paramerters: ResearchParameters = Field()
    research_plan: GeneratedObjectSchema = Field()
    analisys: ReflectionResultSchema = Field()
    report: str = Field()
    research_plan_human_edit: bool | None = Field(default=None)


class InputState(BaseModel):
    user_input: str = Field()


class OutputState(BaseModel):
    graph_output: str = Field()


def _research_plan_human_judge(state: State, config: RunnableConfig):
    print("調査計画:")

    while True:
        feedback = interrupt("編集しますか？ y or n: ")
        if feedback == "y":
            state.research_plan_human_edit = True
            break
        elif feedback == "n":
            state.research_plan_human_edit = False
            break

    return state


def node_generate_research_parameters(state: InputState, config: RunnableConfig):
    return


def node_make_research_plan(state: State, config: RunnableConfig):
    return


def node_web_search(state: State, config: RunnableConfig):
    return


def node_analyze_research_result_and_reflect(state: State, config: RunnableConfig):
    return


def node_make_report(state: OutputState, config: RunnableConfig):
    return


def routing_human_edit_judge(state: State):
    if state.research_plan_human_edit:
        return "edit"
    else:
        return "search"


def node_edit_research_plan(state: State):
    return


def main():
    graph = StateGraph(State, input_schema=InputState, output_schema=OutputState)
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
    graph = graph.compile()

    graph_image = graph.get_graph().draw_mermaid_png()
    with open("./graph.png", "wb") as file:
        file.write(graph_image)


if __name__ == "__main__":
    main()
