import os
from collections import defaultdict
from dataclasses import dataclass
from typing import Any, Dict, List, NamedTuple

import pytest

os.environ.setdefault("OPENAI_API_KEY", "test-key")

from src.backend.api import workflow


class DummyModel:
    def __init__(self, label: str) -> None:
        self.label = label

    def model_dump(self) -> Dict[str, Any]:
        return {"label": self.label, "nested": {"value": 42}}


class SimpleInterrupt:
    def __init__(self, interrupt_id: str, value: str) -> None:
        self.id = interrupt_id
        self.value = value


@dataclass
class DummySnapshot:
    values: Dict[str, Any]
    next: Any | None


class ScriptStep(NamedTuple):
    events: List[Any]
    state: DummySnapshot


class DummyGraph:
    """LangGraph 互換の最小実装。"""

    def __init__(self) -> None:
        self.scripts: Dict[str, List[ScriptStep]] = {}
        self.indices: defaultdict[str, int] = defaultdict(int)
        self.states: Dict[str, DummySnapshot] = {}

    def set_script(self, thread_id: str, steps: List[ScriptStep]) -> None:
        self.scripts[thread_id] = steps
        self.indices[thread_id] = 0

    async def astream_events(
        self, payload: Any, *, config: Dict[str, Any], version: str
    ) -> Any:
        thread_id: str = config["configurable"]["thread_id"]
        step_index = self.indices[thread_id]
        script = self.scripts[thread_id][step_index]
        self.states[thread_id] = script.state
        try:
            for event in script.events:
                yield event
        finally:
            self.indices[thread_id] += 1

    def get_state(self, config: Dict[str, Any]) -> DummySnapshot | None:
        thread_id: str = config["configurable"]["thread_id"]
        return self.states.get(thread_id)


@pytest.fixture()
def service(monkeypatch: pytest.MonkeyPatch):
    graph = DummyGraph()

    class StubAgent:
        def __init__(self) -> None:
            self.graph = graph

        def get_compiled_graph(self) -> DummyGraph:
            return self.graph

    monkeypatch.setattr(workflow, "OSSDeepResearchAgent", StubAgent)
    monkeypatch.setattr(workflow, "Interrupt", SimpleInterrupt)
    monkeypatch.setenv("GRAPH_RECURSION_LIMIT", "7")

    svc = workflow.WorkflowService()

    prompt_interrupt = SimpleInterrupt(
        "plan_judge", "調査計画を編集しますか？"
    )
    model = DummyModel("alpha")
    graph.set_script(
        "thread-1",
        [
            ScriptStep(
                events=[
                    {"event": "message", "data": "warmup"},
                    {
                        "event": "on_chain_stream",
                        "data": {
                            "chunk": {
                                "__interrupt__": [prompt_interrupt],
                                "model": model,
                            }
                        },
                    },
                ],
                state=DummySnapshot(values={"step": model}, next=["continue"]),
            ),
            ScriptStep(
                events=[
                    {
                        "event": "on_chain_end",
                        "data": {"output": {"__interrupt__": []}},
                    },
                ],
                state=DummySnapshot(values={"report": "done"}, next=None),
            ),
        ],
    )

    auto_interrupt = SimpleInterrupt("auto", "別の質問を検討しますか？")
    graph.set_script(
        "auto-thread",
        [
            ScriptStep(
                events=[
                    {
                        "event": "on_chain_stream",
                        "data": {"chunk": {"__interrupt__": [auto_interrupt]}},
                    }
                ],
                state=DummySnapshot(values={"stage": "auto"}, next=["next"]),
            ),
            ScriptStep(
                events=[{"event": "on_chain_end", "data": {"output": {}}}],
                state=DummySnapshot(values={"stage": "auto-done"}, next=None),
            ),
        ],
    )

    graph.set_script(
        "sse-thread",
        [
            ScriptStep(
                events=[{"event": "info", "data": {"note": "first"}}],
                state=DummySnapshot(values={"progress": 1}, next=None),
            ),
        ],
    )

    return svc, graph


@pytest.mark.asyncio
async def test_start_research_returns_interrupt(service):
    svc, _ = service
    outcome = await svc.start_research(thread_id="thread-1", query="test")
    assert outcome.status == "pending_human"
    assert outcome.interrupt == {
        "id": "plan_judge",
        "value": "調査計画を編集しますか？",
    }
    assert [event["event"] for event in outcome.events] == [
        "message",
        "on_chain_stream",
    ]
    assert svc.list_active_threads() == ["thread-1"]
    assert svc.list_pending_interrupts() == ["thread-1"]

    snapshot = svc.get_state("thread-1")
    assert snapshot.status == "pending_human"
    assert snapshot.state == {"step": {"label": "alpha", "nested": {"value": 42}}}
    assert snapshot.pending_interrupt == {
        "id": "plan_judge",
        "value": "調査計画を編集しますか？",
    }


@pytest.mark.asyncio
async def test_resume_research_completes(service):
    svc, _ = service
    await svc.start_research(thread_id="thread-1", query="test")
    outcome = await svc.resume_research(
        thread_id="thread-1", decision="y", plan_update={"updated": True}
    )

    assert outcome.status == "completed"
    assert outcome.interrupt is None
    assert svc.list_active_threads() == []
    assert svc.list_pending_interrupts() == []

    snapshot = svc.get_state("thread-1")
    assert snapshot.status == "completed"
    assert snapshot.state == {"report": "done"}


@pytest.mark.asyncio
async def test_resume_requires_hitl(service):
    svc, _ = service
    with pytest.raises(workflow.HitlNotEnabledError):
        await svc.resume_research(thread_id="unknown", decision="n", plan_update=None)


@pytest.mark.asyncio
async def test_resume_requires_pending_interrupt(service):
    svc, _ = service
    svc._hitl_threads.add("no-pending")
    with pytest.raises(workflow.InterruptNotFoundError):
        await svc.resume_research(
            thread_id="no-pending", decision="n", plan_update=None
        )


def test_get_state_not_found(service):
    svc, graph = service
    graph.states.pop("missing", None)
    with pytest.raises(workflow.StateNotFoundError):
        svc.get_state("missing")


@pytest.mark.asyncio
async def test_stream_events(service):
    svc, _ = service
    frames = []
    async for frame in svc.stream_events(
        thread_id="sse-thread", query="anything", auto_resume=False
    ):
        frames.append(frame)

    assert frames[0].startswith("event: info")
    assert "state_snapshot" in frames[-1]


def test_render_event(service):
    svc, _ = service
    rendered = svc.render_event({"event": "custom", "data": {"value": 1}})
    assert rendered.startswith("event: custom")
    assert rendered.endswith("\n\n")


@pytest.mark.asyncio
async def test_auto_resume_flow(service):
    svc, _ = service
    outcome = await svc.start_research(thread_id="auto-thread", query="auto")
    assert outcome.status == "completed"
    assert any(event["event"] == "auto_resume" for event in outcome.events)
    assert outcome.interrupt is None


def test_internal_helpers(service):
    svc, graph = service
    svc._hitl_threads.clear()
    graph.states["running-thread"] = DummySnapshot(values={"foo": 1}, next=["step"])
    state = svc.get_state("running-thread")
    assert state.status == "running"

    assert svc._serialize_interrupt(None) is None
    interrupt = SimpleInterrupt("id", "value")
    assert svc._serialize_interrupt(interrupt) == {"id": "id", "value": "value"}

    auto_event = svc._sanitize_event("plain")
    assert auto_event == {"event": "message", "data": "plain"}

    complex_event = svc._sanitize_event(
        {"event": "complex", "data": DummyModel("beta")}
    )
    assert complex_event["data"] == {"label": "beta", "nested": {"value": 42}}

    assert svc._is_plan_edit_interrupt(SimpleInterrupt("plan", "編集しますか？"))
    assert not svc._is_plan_edit_interrupt(SimpleInterrupt("other", "別メッセージ"))
    assert not svc._is_run_finished(DummySnapshot(values={}, next=[1]))
    assert svc._is_run_finished(DummySnapshot(values={}, next=None))

    encoded = svc._format_sse({"event": "ping", "data": {"ok": True}})
    assert encoded.startswith("event: ping")


def test_extract_and_convert_helpers(service):
    svc, _ = service
    interrupt_event = {
        "event": "on_chain_end",
        "data": {
            "output": {"__interrupt__": [SimpleInterrupt("resume", "再開しますか")]}
        },
    }
    extracted = svc._extract_interrupt(interrupt_event)
    assert isinstance(extracted, SimpleInterrupt)

    assert svc._extract_interrupt({"event": "noop", "data": "string"}) is None

    class Unknown:
        def __repr__(self) -> str:  # noqa: D401
            return "unknown"

    payload = {"mixed": [Unknown(), {"inner": Unknown()}]}
    converted = svc._convert_model(payload)
    assert converted["mixed"][0] == "unknown"
    assert converted["mixed"][1]["inner"] == "unknown"


def test_recursion_limit_loading(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("GRAPH_RECURSION_LIMIT", "invalid")

    class StubAgent:
        def __init__(self) -> None:
            pass

        def get_compiled_graph(self) -> DummyGraph:
            return DummyGraph()

    monkeypatch.setattr(workflow, "OSSDeepResearchAgent", StubAgent)
    svc = workflow.WorkflowService()
    assert svc._recursion_limit == 100


def test_resolve_allowed_origins(monkeypatch: pytest.MonkeyPatch):
    from src.backend.api import main

    monkeypatch.setenv("CORS_ALLOW_ORIGINS", "https://example.com, https://foo")
    origins = main._resolve_allowed_origins()
    assert origins == ["https://example.com", "https://foo"]

    monkeypatch.delenv("CORS_ALLOW_ORIGINS", raising=False)
    defaults = set(main._resolve_allowed_origins())
    assert {"http://localhost:3000", "http://127.0.0.1:3000"}.issubset(defaults)


def test_create_thread_and_diagnostics(service):
    svc, _ = service
    thread_id = svc.create_thread_id()
    import uuid

    uuid.UUID(thread_id)
    stats = svc.diagnostics()
    assert stats["recursion_limit"] == 7


def test_serialize_state_errors(service):
    svc, graph = service
    graph.states.pop("missing", None)
    with pytest.raises(workflow.StateNotFoundError):
        svc._serialize_state("missing")
    assert not svc._is_run_finished(None)


@pytest.mark.asyncio
async def test_astream_emits_interrupt(service):
    svc, _ = service
    events = []
    async for event in svc._astream(
        {"user_input": "test"},
        thread_id="thread-1",
        auto_resume=False,
        interrupt_predicate=lambda _: True,
    ):
        events.append(event)

    names = [event["event"] for event in events]
    assert "interrupt" in names
