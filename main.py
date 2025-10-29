from langchain_core.runnables import RunnableConfig
from langgraph.graph import END, START, StateGraph
from pydantic import BaseModel, Field


class State(BaseModel):
    value: str = Field()


class InputState(BaseModel):
    user_input: str = Field()


class OutputState(BaseModel):
    graph_output: str = Field()


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


def main():
    graph = StateGraph(State, input_schema=InputState, output_schema=OutputState)
    graph.add_node(node_generate_research_parameters)
    graph.add_node(node_make_research_plan)
    graph.add_node(node_web_search)
    graph.add_node(node_analyze_research_result_and_reflect)
    graph.add_node(node_make_report)
    graph.add_edge(START, "node_generate_research_parameters")
    graph.add_edge("node_generate_research_parameters", "node_make_research_plan")
    graph.add_edge("node_make_research_plan", "node_web_search")
    graph.add_edge("node_web_search", "node_analyze_research_result_and_reflect")
    graph.add_edge("node_analyze_research_result_and_reflect", "node_make_report")
    graph.add_edge("node_make_report", END)
    graph = graph.compile()

    graph_image = graph.get_graph().draw_mermaid_png()
    with open("./graph.png", "wb") as file:
        file.write(graph_image)
    # graph.invoke({"messages": [{"role": "user", "content": "hi!"}]})


if __name__ == "__main__":
    main()
