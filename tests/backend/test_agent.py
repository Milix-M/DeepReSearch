import types

import pytest
from langchain_core.runnables import RunnableConfig

from src.backend import agent as agent_module
from src.backend.agent import (
    GeneratedObjectSchema,
    NamespaceAwareJsonPlusSerializer,
    OSSDeepResearchAgent,
    ResearchParameters,
    State,
)


class DummyChatOpenAI:
    def __init__(self, **kwargs):
        self.kwargs = kwargs
        self.bound_tools = None

    def with_structured_output(self, schema):
        return types.SimpleNamespace(schema=schema)

    def bind_tools(self, tools):
        self.bound_tools = tuple(tools)
        return DummyToolLLM()


class DummyToolLLM:
    def __init__(self):
        self.calls = []
        self.responses: list = []

    async def ainvoke(self, messages):
        self.calls.append(messages)
        if self.responses:
            return self.responses.pop(0)
        return types.SimpleNamespace(tool_calls=[], content="done")


@pytest.fixture(autouse=True)
def patch_chat_open_ai(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(agent_module, "ChatOpenAI", DummyChatOpenAI)


def test_namespace_serializer_uses_custom_reviver(monkeypatch: pytest.MonkeyPatch):
    serializer = NamespaceAwareJsonPlusSerializer(valid_namespaces=["src"])

    captured = {}

    def fake_reviver(value):
        captured["value"] = value
        return {"ok": True}

    serializer._reviver_with_ns = fake_reviver  # type: ignore[attr-defined]

    assert serializer._reviver({"foo": "bar"}) == {"ok": True}
    assert captured["value"] == {"foo": "bar"}

    serializer._allowed_modules = ["mock"]  # type: ignore[attr-defined]

    def fake_revive_lc2(value):
        raise agent_module.InvalidModuleError("bad")

    serializer._revive_lc2 = fake_revive_lc2  # type: ignore[attr-defined]
    serializer._reviver({"lc": 2, "type": "constructor", "id": "bad"})
    assert captured["value"]["id"] == "bad"


def test_state_validator_restores_legacy_instances():
    class LegacyParams:
        def model_dump(self):
            return {
                "search_queries_per_section": 2,
                "search_iterations": 3,
                "reasoning": "legacy",
            }

    class LegacyPlan:
        def model_dump(self):
            return {
                "research_plan": {
                    "purpose": "reason",
                    "sections": [
                        {
                            "title": "s1",
                            "focus": "focus",
                            "key_questions": ["q1"],
                        }
                    ],
                    "structure": {
                        "introduction": "intro",
                        "conclusion": "outro",
                    },
                },
                "meta_analysis": "analysis",
            }

    state = State.model_validate(
        {
            "user_input": "topic",
            "research_parameters": LegacyParams(),
            "research_plan": LegacyPlan(),
        }
    )

    assert isinstance(state.research_parameters, ResearchParameters)
    assert isinstance(state.research_plan, GeneratedObjectSchema)

    dict_state = State.model_validate(
        {
            "user_input": "topic",
            "research_parameters": {
                "search_queries_per_section": 1,
                "search_iterations": 1,
                "reasoning": "dict",
            },
            "research_plan": LegacyPlan().model_dump(),
        }
    )
    assert isinstance(dict_state.research_parameters, ResearchParameters)
    assert isinstance(dict_state.research_plan, GeneratedObjectSchema)


def test_agent_initialization_applies_nest_asyncio(monkeypatch: pytest.MonkeyPatch):
    def raise_runtime_error(*_args, **_kwargs):
        raise RuntimeError

    applied = {}

    def fake_apply(loop):
        applied["loop"] = loop
        raise ValueError("already patched")

    monkeypatch.setattr(agent_module.asyncio, "get_running_loop", raise_runtime_error)
    monkeypatch.setattr(agent_module.asyncio, "get_event_loop", raise_runtime_error)
    monkeypatch.setattr(agent_module.nest_asyncio, "apply", fake_apply)

    agent = OSSDeepResearchAgent()

    assert applied["loop"] is None
    assert len(agent.tools) == 3
    assert isinstance(agent.tool_callable_llm, DummyChatOpenAI)
    assert isinstance(agent.llm_with_tools, DummyToolLLM)


@pytest.mark.asyncio
async def test_agent_nodes_and_routing(monkeypatch: pytest.MonkeyPatch):
    generated_params = ResearchParameters(
        search_queries_per_section=1,
        search_iterations=2,
        reasoning="ok",
    )

    plan_payload = {
        "research_plan": {
            "purpose": "goal",
            "sections": [
                {
                    "title": "t",
                    "focus": "f",
                    "key_questions": ["q"],
                }
            ],
            "structure": {
                "introduction": "intro",
                "conclusion": "outro",
            },
        },
        "meta_analysis": "meta",
    }
    generated_plan = GeneratedObjectSchema.model_validate(plan_payload)

    class DummyQueryAnalyzeAI:
        def __init__(self, llm):
            self.llm = llm
            self.calls: list = []

        async def __call__(self, query: str):
            self.calls.append(query)
            return generated_params

    class DummyPlanResearchAI:
        def __init__(self, llm):
            self.llm = llm
            self.calls: list = []

        async def __call__(self, query: str):
            self.calls.append(query)
            return generated_plan

    dummy_tool_llm = DummyToolLLM()
    dummy_tool_llm.responses = [
        types.SimpleNamespace(tool_calls=[{"tool": "call"}], content="tool"),
        types.SimpleNamespace(
            tool_calls=[],
            content=[
                {"text": "fragment"},
                {"type": "text", "text": "more"},
                {"other": 1},
                "tail",
            ],
        ),
    ]

    monkeypatch.setattr(agent_module, "QueryAnalyzeAI", DummyQueryAnalyzeAI)
    monkeypatch.setattr(agent_module, "PlanResearchAI", DummyPlanResearchAI)

    agent = OSSDeepResearchAgent()
    agent.llm_with_tools = dummy_tool_llm  # type: ignore[assignment]

    state = State(
        user_input="topic",
        research_parameters=None,
        research_plan=None,
    )

    result_params = await agent._node_generate_research_parameters(
        state, RunnableConfig()
    )
    assert result_params["research_parameters"] is generated_params

    state.research_parameters = generated_params
    result_plan = await agent._node_make_research_plan(state, RunnableConfig())
    assert result_plan["research_plan"] == generated_plan

    state.research_plan = generated_plan
    prepared = agent._node_prepare_research(state)
    assert len(prepared["messages"]) == 2
    state.messages.extend(prepared["messages"])

    monkeypatch.setattr(agent_module, "interrupt", lambda _prompt: "y")
    await agent._research_plan_human_judge(state, RunnableConfig())
    assert state.research_plan_human_edit is True

    monkeypatch.setattr(agent_module, "interrupt", lambda _prompt: "n")
    await agent._research_plan_human_judge(state, RunnableConfig())
    assert state.research_plan_human_edit is False

    patched_plan = agent._node_edit_research_plan(
        State(
            research_plan=GeneratedObjectSchema.model_validate(plan_payload),
            user_input="topic",
        )
    )
    assert isinstance(patched_plan["research_plan"], GeneratedObjectSchema)

    class LegacyPlanWrapper:
        def model_dump(self):
            return plan_payload

    wrapped_state = State.model_validate(
        {
            "user_input": "topic",
            "research_parameters": generated_params,
            "research_plan": LegacyPlanWrapper(),
        }
    )
    wrapped_plan = agent._node_edit_research_plan(wrapped_state)
    assert isinstance(wrapped_plan["research_plan"], GeneratedObjectSchema)

    dict_state = State.model_validate(
        {
            "user_input": "topic",
            "research_parameters": generated_params,
            "research_plan": plan_payload,
        }
    )
    dict_plan = agent._node_edit_research_plan(dict_state)
    assert isinstance(dict_plan["research_plan"], GeneratedObjectSchema)
    raw_state = State.model_construct(
        user_input="topic",
        research_parameters=generated_params,
        research_plan=LegacyPlanWrapper(),
    )
    raw_plan = agent._node_edit_research_plan(raw_state)
    assert isinstance(raw_plan["research_plan"], GeneratedObjectSchema)

    raw_dict_state = State.model_construct(
        user_input="topic",
        research_parameters=generated_params,
        research_plan=plan_payload,
    )
    raw_dict_plan = agent._node_edit_research_plan(raw_dict_state)
    assert isinstance(raw_dict_plan["research_plan"], GeneratedObjectSchema)
    assert agent._node_edit_research_plan(State(user_input="topic")) == {}

    loop_state = State(
        user_input="topic",
        research_parameters=generated_params,
        research_plan=generated_plan,
        messages=list(state.messages),
    )
    loop_state.messages.extend(
        (await agent._node_deep_research(loop_state, RunnableConfig()))["messages"]
    )
    assert agent._routing_should_continue(loop_state) == "continue_react_loop"

    loop_state.messages.extend(
        (await agent._node_deep_research(loop_state, RunnableConfig()))["messages"]
    )
    assert agent._routing_should_continue(loop_state) == "finish_research"

    assert (
        agent._routing_human_edit_judge(
            State(user_input="q", research_plan_human_edit=True)
        )
        == "edit"
    )
    assert (
        agent._routing_human_edit_judge(
            State(user_input="q", research_plan_human_edit=False)
        )
        == "search"
    )

    summary = agent._node_write_research_result(loop_state)
    report = summary.get("report") or ""
    assert "fragment" in report

    string_summary = agent._node_write_research_result(
        State(messages=[types.SimpleNamespace(content="final")], user_input="q")
    )
    assert string_summary["report"] == "final"

    value_summary = agent._node_write_research_result(
        State(
            messages=[
                types.SimpleNamespace(content=[{"type": "text", "value": "alt"}])
            ],
            user_input="q",
        )
    )
    alt_report = value_summary.get("report") or ""
    assert "alt" in alt_report


def test_agent_skips_nest_asyncio_on_uvloop(monkeypatch: pytest.MonkeyPatch):
    class UVLoop:
        __module__ = "uvloop.loop"

    monkeypatch.setattr(agent_module.asyncio, "get_running_loop", lambda: UVLoop())
    called = []

    def fake_apply(loop):
        called.append(loop)

    monkeypatch.setattr(agent_module.nest_asyncio, "apply", fake_apply)

    agent = OSSDeepResearchAgent()
    assert called == []
    assert isinstance(agent.llm_with_tools, DummyToolLLM)


def test_get_compiled_graph_uses_custom_serializer(monkeypatch: pytest.MonkeyPatch):
    recorded = {}

    class DummyStateGraph:
        def __init__(self, state_cls):
            recorded["state_cls"] = state_cls
            self.nodes = []
            self.edges = []

        def add_node(self, name_or_callable, maybe_fn=None):
            if maybe_fn is None:
                self.nodes.append(name_or_callable)
            else:
                self.nodes.append((name_or_callable, maybe_fn))

        def add_edge(self, source, target):
            self.edges.append((source, target))

        def add_conditional_edges(self, node, router, mapping):
            self.edges.append((node, tuple(mapping.items())))

        def compile(self, checkpointer):
            recorded["checkpointer"] = checkpointer
            return "compiled"

    class DummyToolNode:
        def __init__(self, tools):
            recorded["tools"] = tuple(tools)

    class DummyMemorySaver:
        def __init__(self, serde):
            recorded["serde"] = serde

    monkeypatch.setattr(agent_module, "StateGraph", DummyStateGraph)
    monkeypatch.setattr(agent_module, "ToolNode", DummyToolNode)
    monkeypatch.setattr(agent_module, "MemorySaver", DummyMemorySaver)

    agent = OSSDeepResearchAgent()
    compiled = agent.get_compiled_graph()

    assert compiled == "compiled"
    assert recorded["state_cls"] is State
    assert isinstance(recorded["serde"], NamespaceAwareJsonPlusSerializer)
    assert len(recorded["tools"]) == 3
