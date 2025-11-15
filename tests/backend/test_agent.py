import builtins
import os
import types

import pytest
from langchain_core.runnables import RunnableConfig

os.environ.setdefault("TAVILY_API_KEY", "test")

import src.backend.agent as agent_module
from src.backend.agent import (
    GeneratedObjectSchema,
    NamespaceAwareJsonPlusSerializer,
    OSSDeepResearchAgent,
    ResearchParameters,
    State,
)


class DummyTool:
    """LangGraph ToolNode 互換の最小オブジェクト。"""

    def __init__(self, name: str):
        self.name = name


class DummyChatOpenAI:
    """ChatOpenAI の挙動を記録するだけのスタブ。"""

    def __init__(self, **kwargs):
        self.kwargs = kwargs


@pytest.fixture(autouse=True)
def patch_dependencies(monkeypatch: pytest.MonkeyPatch):
    created_tools = []

    def fake_tavily(*_args, **_kwargs):
        tool = DummyTool("web_tool")
        created_tools.append(tool)
        return tool

    reflect_tool = DummyTool("reflect_tool")
    monkeypatch.setattr(agent_module, "TavilySearch", fake_tavily)
    monkeypatch.setattr(agent_module, "reflect_on_results", reflect_tool)
    monkeypatch.setattr(agent_module, "ChatOpenAI", DummyChatOpenAI)
    return {"created_tools": created_tools, "reflect_tool": reflect_tool}


def test_namespace_serializer_reviver_handles_allowlist(
    monkeypatch: pytest.MonkeyPatch,
):
    """NamespaceAwareJsonPlusSerializer が許可リストを尊重して復元処理を行うことを検証するテスト。

    Args:
        monkeypatch (pytest.MonkeyPatch): 内部の復元関数を差し替えて挙動を観測するためのフィクスチャ。
    """
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


def test_state_validator_converts_legacy_models():
    """State バリデータがレガシー形式のモデル入力を現在のスキーマへ正規化することを検証するテスト。"""

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


def test_agent_initialization_applies_patch(
    patch_dependencies, monkeypatch: pytest.MonkeyPatch
):
    """イベントループ未初期化時に nest_asyncio のパッチが適用されることを検証するテスト。

    Args:
        monkeypatch (pytest.MonkeyPatch): asyncio のループ取得とパッチ適用関数を差し替えるフィクスチャ。
    """

    def raise_runtime_error(*_args, **_kwargs):
        raise RuntimeError

    applied = {}

    def fake_apply(loop):
        applied["loop"] = loop
        raise ValueError("patched")

    monkeypatch.setattr(agent_module.asyncio, "get_running_loop", raise_runtime_error)
    monkeypatch.setattr(agent_module.asyncio, "get_event_loop", raise_runtime_error)
    monkeypatch.setattr(agent_module.nest_asyncio, "apply", fake_apply)

    agent = OSSDeepResearchAgent()

    assert applied["loop"] is None
    assert agent.tools[0].name == "web_tool"
    assert agent.tools[1].name == "reflect_tool"
    assert agent.llm.kwargs["model"] == "tngtech/deepseek-r1t2-chimera:free"
    assert agent.tool_callable_llm.kwargs["model"] == "z-ai/glm-4.5-air:free"
    assert patch_dependencies["created_tools"]  # TavilySearch が呼び出された


def test_agent_skips_patch_for_uvloop(
    patch_dependencies, monkeypatch: pytest.MonkeyPatch
):
    """uvloop 実行時には nest_asyncio のパッチがスキップされることを検証するテスト。

    Args:
        monkeypatch (pytest.MonkeyPatch): uvloop を模倣するループとパッチ適用関数を差し替えるフィクスチャ。
    """

    class UVLoop:
        __module__ = "uvloop.loop"

    monkeypatch.setattr(agent_module.asyncio, "get_running_loop", lambda: UVLoop())
    called = []

    def fake_apply(loop):
        called.append(loop)

    monkeypatch.setattr(agent_module.nest_asyncio, "apply", fake_apply)

    agent = OSSDeepResearchAgent()

    assert called == []
    assert agent.tools[0].name == "web_tool"


@pytest.mark.asyncio
async def test_agent_nodes_cover_all_paths(monkeypatch: pytest.MonkeyPatch):
    """エージェントの各ノードとルーティング分岐が期待通りに動作することを網羅的に検証する統合テスト。

    Args:
        monkeypatch (pytest.MonkeyPatch): LangGraph ノードに関連する依存をダミー実装へ差し替えるフィクスチャ。
    """
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
            self.calls = []

        async def __call__(self, query: str):
            self.calls.append(query)
            return generated_params

    class DummyPlanResearchAI:
        def __init__(self, llm):
            self.llm = llm
            self.calls = []

        async def __call__(self, query: str):
            self.calls.append(query)
            return generated_plan

    class DummyDeepResearchAgent:
        def __init__(self):
            self.calls = []
            self.response = {
                "messages": [
                    types.SimpleNamespace(
                        content=[
                            {"text": "fragment"},
                            {"type": "text", "text": "more"},
                            {"type": "text", "value": "alt"},
                            {"other": 1},
                            "tail",
                        ]
                    )
                ]
            }

        async def ainvoke(self, payload):
            self.calls.append(payload)
            return self.response

    dummy_deep_agent = DummyDeepResearchAgent()

    monkeypatch.setattr(agent_module, "QueryAnalyzeAI", DummyQueryAnalyzeAI)
    monkeypatch.setattr(agent_module, "PlanResearchAI", DummyPlanResearchAI)
    monkeypatch.setattr(agent_module, "create_agent", lambda **_: dummy_deep_agent)

    agent = OSSDeepResearchAgent()

    state = State(user_input="topic")
    params_result = await agent._node_generate_research_parameters(
        state, RunnableConfig()
    )
    assert params_result["research_parameters"] is generated_params

    state.research_parameters = generated_params
    plan_result = await agent._node_make_research_plan(state, RunnableConfig())
    state.research_plan = plan_result["research_plan"]

    normalized_plan = agent._node_edit_research_plan(state)
    assert normalized_plan["research_plan"] is plan_result["research_plan"]

    assert agent._node_edit_research_plan(State(user_input="empty")) == {}

    class Wrapper:
        def model_dump(self):
            return plan_payload

    wrapped_state = State(user_input="t")
    wrapped_state.__dict__["research_plan"] = Wrapper()
    assert isinstance(
        agent._node_edit_research_plan(wrapped_state)["research_plan"],
        GeneratedObjectSchema,
    )

    dict_state = State(user_input="t")
    dict_state.__dict__["research_plan"] = plan_payload
    assert isinstance(
        agent._node_edit_research_plan(dict_state)["research_plan"],
        GeneratedObjectSchema,
    )

    responses = iter(["y", "n", "maybe"])
    monkeypatch.setattr(agent_module, "interrupt", lambda _prompt: next(responses))

    await agent._research_plan_human_judge(state, RunnableConfig())
    assert state.research_plan_human_edit is True

    await agent._research_plan_human_judge(state, RunnableConfig())
    assert state.research_plan_human_edit is False

    await agent._research_plan_human_judge(state, RunnableConfig())
    assert state.research_plan_human_edit is False

    deep_messages = await agent._node_deep_research(state, RunnableConfig())
    assert dummy_deep_agent.calls[0]["messages"][0]["content"] == "topic"
    state.messages.extend(deep_messages["messages"])

    summary = agent._node_write_research_result(state)
    report = summary.get("report") or ""
    assert "fragment" in report and "tail" in report

    simple_summary = agent._node_write_research_result(
        State(
            user_input="t",
            messages=[types.SimpleNamespace(content="final")],
        )
    )
    assert simple_summary["report"] == "final"

    none_summary = agent._node_write_research_result(State(user_input="empty"))
    assert none_summary["report"] is None

    assert (
        agent._routing_human_edit_judge(
            State(user_input="t", research_plan_human_edit=True)
        )
        == "edit"
    )
    assert (
        agent._routing_human_edit_judge(
            State(user_input="t", research_plan_human_edit=False)
        )
        == "search"
    )


def test_get_compiled_graph_uses_custom_serializer(monkeypatch: pytest.MonkeyPatch):
    """グラフ構築時にカスタムシリアライザとダミーの描画処理が利用されることを検証するテスト。

    Args:
        monkeypatch (pytest.MonkeyPatch): LangGraph のノードやシリアライザをダミー実装へ差し替えるフィクスチャ。
    """
    recorded = {}

    class DummyStateGraph:
        def __init__(self, state_cls):
            recorded["state_cls"] = state_cls
            self.nodes = []
            self.edges = []

        def add_node(self, identifier, maybe_fn=None):
            if maybe_fn is None:
                self.nodes.append(identifier)
            else:
                self.nodes.append((identifier, maybe_fn))

        def add_edge(self, source, target):
            self.edges.append((source, target))

        def add_conditional_edges(self, node, router, mapping):
            self.edges.append((node, tuple(mapping.items())))

        def compile(self, checkpointer):
            recorded["checkpointer"] = checkpointer
            return DummyCompiledGraph()

    class DummyMemorySaver:
        def __init__(self, serde):
            recorded["serde"] = serde

    class DummyGraphImage:
        def draw_mermaid_png(self):
            recorded["image"] = True
            return b"png"

    class DummyCompiledGraph:
        def get_graph(self):
            return DummyGraphImage()

    class DummyFile:
        def __init__(self):
            self.writes = []

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

        def write(self, data):
            self.writes.append(data)

    dummy_file = DummyFile()

    monkeypatch.setattr(agent_module, "StateGraph", DummyStateGraph)
    monkeypatch.setattr(agent_module, "MemorySaver", DummyMemorySaver)
    monkeypatch.setattr(builtins, "open", lambda path, mode: dummy_file)

    agent = OSSDeepResearchAgent()
    compiled = agent.get_compiled_graph()

    assert isinstance(compiled, DummyCompiledGraph)
    assert recorded["state_cls"] is State
    assert isinstance(recorded["serde"], NamespaceAwareJsonPlusSerializer)
    assert dummy_file.writes == [b"png"]
