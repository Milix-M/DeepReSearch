import os
from dataclasses import dataclass
from typing import Any, Dict, List

import pytest

from src.backend.api import workflow
from src.backend.api.workflow import service as workflow_service_module

os.environ.setdefault("OPENROUTER_API_KEY", "dummy")


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


@dataclass
class ScriptStep:
    events: List[Dict[str, Any]]
    state: DummySnapshot


class DummyCommand:
    def __init__(self, **kwargs) -> None:
        self.payload = kwargs


class DummyGraph:
    def __init__(self) -> None:
        self.scripts: Dict[str, List[ScriptStep]] = {}
        self.indices: Dict[str, int] = {}
        self.states: Dict[str, DummySnapshot] = {}

    def set_script(self, thread_id: str, steps: List[ScriptStep]) -> None:
        self.scripts[thread_id] = steps
        self.indices[thread_id] = 0

    async def astream_events(
        self, payload: Any, *, config: Dict[str, Any], version: str
    ):
        thread_id: str = config["configurable"]["thread_id"]
        index = self.indices[thread_id]
        step = self.scripts[thread_id][index]
        self.states[thread_id] = step.state
        try:
            for event in step.events:
                yield event
        finally:
            self.indices[thread_id] = index + 1

    def get_state(self, config: Dict[str, Any]) -> DummySnapshot | None:
        thread_id: str = config["configurable"]["thread_id"]
        return self.states.get(thread_id)


@pytest.fixture()
def service(monkeypatch: pytest.MonkeyPatch):
    graph = DummyGraph()

    class StubAgent:

        def get_compiled_graph(self):
            return graph

    monkeypatch.setenv("GRAPH_RECURSION_LIMIT", "7")
    monkeypatch.setattr(workflow_service_module, "OSSDeepResearchAgent", StubAgent)
    monkeypatch.setattr(workflow_service_module, "Interrupt", SimpleInterrupt)
    monkeypatch.setattr(workflow_service_module, "Command", DummyCommand)

    svc = workflow.WorkflowService()

    model = DummyModel("alpha")
    graph.set_script(
        "manual-thread",
        [
            ScriptStep(
                events=[
                    {"event": "on_chain_start", "data": DummyModel("alpha")},
                    {
                        "event": "on_chain_stream",
                        "data": {
                            "chunk": {
                                "__interrupt__": [
                                    SimpleInterrupt(
                                        "manual", "調査計画を編集しますか？"
                                    )
                                ],
                                "model": model,
                            }
                        },
                    },
                ],
                state=DummySnapshot(values={"step": model}, next=["continue"]),
            ),
            ScriptStep(
                events=[{"event": "on_chain_end", "data": {"output": {}}}],
                state=DummySnapshot(values={"report": "done"}, next=None),
            ),
        ],
    )

    graph.set_script(
        "auto-thread",
        [
            ScriptStep(
                events=[
                    {
                        "event": "on_chain_stream",
                        "data": {
                            "chunk": {
                                "__interrupt__": [
                                    SimpleInterrupt("auto", "別の質問を検討しますか？")
                                ]
                            }
                        },
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

    graph.set_script(
        "error-thread",
        [
            ScriptStep(
                events=[{"event": "chain_error", "data": {"error": {"code": 1}}}],
                state=DummySnapshot(values={"result": "ng"}, next=None),
            ),
        ],
    )

    return svc, graph


@pytest.mark.asyncio
async def test_start_research_returns_interrupt(service):
    """HITL 対応スレッドで start_research が割り込み情報と状態遷移を返すことを検証するテスト。

    Args:
        service (tuple[workflow.WorkflowService, DummyGraph]): テスト用に差し替えたサービスとグラフのペア。
    """
    svc, _ = service
    outcome = await svc.start_research(thread_id="manual-thread", query="test")
    assert outcome.status == "pending_human"
    assert outcome.interrupt == {
        "id": "manual",
        "value": "調査計画を編集しますか？",
    }
    assert [event["event"] for event in outcome.events] == [
        "on_chain_start",
        "on_chain_stream",
    ]
    assert svc.list_active_threads() == ["manual-thread"]
    assert svc.list_pending_interrupts() == ["manual-thread"]

    snapshot = svc.get_state("manual-thread")
    assert snapshot.status == "pending_human"
    assert snapshot.state == {"step": {"label": "alpha", "nested": {"value": 42}}}
    assert snapshot.pending_interrupt == {
        "id": "manual",
        "value": "調査計画を編集しますか？",
    }


@pytest.mark.asyncio
async def test_resume_research_completes(service):
    """start_research 後に resume_research が完了イベントまで進めることを検証するテスト。

    Args:
        service (tuple[workflow.WorkflowService, DummyGraph]): テスト用に差し替えたサービスとグラフのペア。
    """
    svc, _ = service
    await svc.start_research(thread_id="manual-thread", query="topic")
    outcome = await svc.resume_research(
        thread_id="manual-thread", decision="y", plan_update={"updated": True}
    )
    assert outcome.status == "completed"
    assert outcome.interrupt is None
    assert svc.list_active_threads() == []
    assert svc.list_pending_interrupts() == []

    snapshot = svc.get_state("manual-thread")
    assert snapshot.status == "completed"
    assert snapshot.state == {"report": "done"}


@pytest.mark.asyncio
async def test_resume_requires_hitl_thread(service):
    """HITL 登録がないスレッドで resume_research を呼び出すと例外が発生することを検証するテスト。

    Args:
        service (tuple[workflow.WorkflowService, DummyGraph]): テスト用に差し替えたサービスとグラフのペア。
    """
    svc, _ = service
    with pytest.raises(workflow.HitlNotEnabledError):
        await svc.resume_research(thread_id="unknown", decision="n", plan_update=None)


@pytest.mark.asyncio
async def test_resume_requires_pending_interrupt(service):
    """割り込み未保留状態で resume_research を呼ぶと InterruptNotFoundError が送出されることを検証するテスト。

    Args:
        service (tuple[workflow.WorkflowService, DummyGraph]): テスト用に差し替えたサービスとグラフのペア。
    """
    svc, _ = service
    svc._hitl_threads.add("missing")
    with pytest.raises(workflow.InterruptNotFoundError):
        await svc.resume_research(thread_id="missing", decision="n", plan_update=None)


def test_get_state_variants(service):
    """get_state が存在するスレッドの状態を返し、存在しない場合は例外を送出することを検証するテスト。

    Args:
        service (tuple[workflow.WorkflowService, DummyGraph]): テスト用に差し替えたサービスとグラフのペア。
    """
    svc, graph = service
    graph.states["running"] = DummySnapshot(values={"foo": 1}, next=["next"])
    status = svc.get_state("running")
    assert status.status == "running"

    graph.states.pop("absent", None)
    with pytest.raises(workflow.StateNotFoundError):
        svc.get_state("absent")


@pytest.mark.asyncio
async def test_stream_events_includes_final_state(service):
    """stream_events が SSE 形式のイベントと最終状態スナップショットを配信することを検証するテスト。

    Args:
        service (tuple[workflow.WorkflowService, DummyGraph]): テスト用に差し替えたサービスとグラフのペア。
    """
    svc, _ = service
    frames = []
    async for frame in svc.stream_events(
        thread_id="sse-thread", query="anything", auto_resume=False
    ):
        frames.append(frame)
    assert frames[0].startswith("event: info")
    assert "state_snapshot" in frames[-1]


@pytest.mark.asyncio
async def test_auto_resume_flow(service):
    """自動再開スレッドで start_research が割り込みを挟まず完了することを検証するテスト。

    Args:
        service (tuple[workflow.WorkflowService, DummyGraph]): テスト用に差し替えたサービスとグラフのペア。
    """
    svc, _ = service
    outcome = await svc.start_research(thread_id="auto-thread", query="auto")
    events = [event["event"] for event in outcome.events]
    assert "auto_resume" in events
    assert outcome.status == "completed"
    assert outcome.interrupt is None


def test_helpers_cover_branches(service):
    """補助メソッド群が各条件分岐で期待通りのシリアライズと判定結果を返すことを検証するテスト。

    Args:
        service (tuple[workflow.WorkflowService, DummyGraph]): テスト用に差し替えたサービスとグラフのペア。
    """
    svc, _ = service
    assert svc._serialize_interrupt(None) is None
    assert svc._serialize_interrupt(SimpleInterrupt("id", "value")) == {
        "id": "id",
        "value": "value",
    }

    sanitized = svc._sanitize_event("text")
    assert sanitized == {"event": "message", "data": "text"}

    complex_event = svc._sanitize_event(
        {"event": "complex", "data": DummyModel("beta")}
    )
    assert complex_event["data"] == {"label": "beta", "nested": {"value": 42}}

    assert svc._is_plan_edit_interrupt(SimpleInterrupt("plan", "編集しますか？"))
    assert not svc._is_plan_edit_interrupt(SimpleInterrupt("other", "別"))
    assert svc._is_run_finished(DummySnapshot(values={}, next=None))
    assert not svc._is_run_finished(DummySnapshot(values={}, next=[1]))

    config = svc._graph_config("manual-thread")
    assert config["recursion_limit"] == 7

    assert svc._get_pending_interrupt("unknown") is None


def test_convert_and_extract_helpers(service):
    """割り込み抽出とモデル変換のヘルパーが複合データを適切に処理することを検証するテスト。

    Args:
        service (tuple[workflow.WorkflowService, DummyGraph]): テスト用に差し替えたサービスとグラフのペア。
    """
    svc, _ = service
    event = {
        "event": "on_chain_end",
        "data": {
            "output": {"__interrupt__": [SimpleInterrupt("resume", "再開しますか")]}
        },
    }
    interrupt = svc._extract_interrupt(event)
    assert isinstance(interrupt, SimpleInterrupt)

    fallback = svc._extract_interrupt({"event": "noop", "data": "x"})
    assert fallback is None

    class Unknown:

        def __repr__(self) -> str:
            return "unknown"

    converted = svc._convert_model({"mixed": [Unknown(), {"inner": Unknown()}]})
    assert converted["mixed"][0] == "unknown"
    assert converted["mixed"][1]["inner"] == "unknown"


def test_error_detection_and_messages(service):
    """エラー関連ヘルパーがエラーフレームの検出とメッセージ生成を正しく行うことを検証するテスト。

    Args:
        service (tuple[workflow.WorkflowService, DummyGraph]): テスト用に差し替えたサービスとグラフのペア。
    """
    svc, _ = service
    assert svc._is_error_event({"event": "error"})
    assert svc._is_error_event({"data": {"error": "bad"}})
    assert not svc._is_error_event({"event": "info", "data": {"note": 1}})
    assert not svc._is_error_event({"data": "string"})

    message = svc._extract_error_message({"data": {"message": "fail"}})
    assert message == "fail"
    message = svc._extract_error_message({"event": "crash"})
    assert message == "crash が発生しました。"
    object_message = svc._extract_error_message({"data": {"error": object()}})
    assert object_message.startswith("<object object")
    default_message = svc._extract_error_message({})
    assert default_message == "LLM処理中にエラーが発生しました。"


@pytest.mark.asyncio
async def test_error_events_are_forwarded_with_level(service):
    """エラーイベントが消費者へ level 付きで伝播することを検証するテスト。

    Args:
        service (tuple[workflow.WorkflowService, DummyGraph]): テスト用に差し替えたサービスとグラフのペア。
    """
    svc, _ = service
    captured: list[dict] = []

    async def consumer(event: dict) -> None:
        captured.append(event)

    outcome = await svc.start_research(
        thread_id="error-thread",
        query="topic",
        event_consumer=consumer,
    )

    assert outcome.status == "completed"
    assert captured[0]["level"] == "error"
    assert "code" in captured[0]["message"]


def test_diagnostics_and_threads(service):
    """diagnostics とスレッド関連 API が識別子生成と統計取得を正常に行うことを検証するテスト。

    Args:
        service (tuple[workflow.WorkflowService, DummyGraph]): テスト用に差し替えたサービスとグラフのペア。
    """
    svc, _ = service
    thread_id = svc.create_thread_id()
    import uuid

    uuid.UUID(thread_id)
    stats = svc.diagnostics()
    assert stats["recursion_limit"] == 7
    assert svc.list_active_threads() == []
    assert svc.list_pending_interrupts() == []


def test_serialize_state_errors(service):
    """シリアライズ対象の状態が存在しない場合に StateNotFoundError が発生することを検証するテスト。

    Args:
        service (tuple[workflow.WorkflowService, DummyGraph]): テスト用に差し替えたサービスとグラフのペア。
    """
    svc, _ = service
    with pytest.raises(workflow.StateNotFoundError):
        svc._serialize_state("unknown")
    assert not svc._is_run_finished(None)


def test_recursion_limit_loading(monkeypatch: pytest.MonkeyPatch):
    """環境変数が不正値のときにデフォルトの再帰制限が採用されることを検証するテスト。

    Args:
        monkeypatch (pytest.MonkeyPatch): 環境変数と依存オブジェクトを差し替えるフィクスチャ。
    """
    monkeypatch.setenv("GRAPH_RECURSION_LIMIT", "invalid")

    class StubAgent:
        def get_compiled_graph(self):
            return DummyGraph()

    monkeypatch.setattr(workflow_service_module, "OSSDeepResearchAgent", StubAgent)
    monkeypatch.setattr(workflow_service_module, "Command", DummyCommand)
    svc = workflow.WorkflowService()
    assert svc._recursion_limit == 100


@pytest.mark.asyncio
async def test_astream_emits_interrupt(service):
    """_astream が割り込み条件を満たしたイベントを生成することを検証するテスト。

    Args:
        service (tuple[workflow.WorkflowService, DummyGraph]): テスト用に差し替えたサービスとグラフのペア。
    """
    svc, _ = service
    events = []
    async for event in svc._astream(
        {"user_input": "topic"},
        thread_id="manual-thread",
        auto_resume=False,
        interrupt_predicate=lambda _: True,
    ):
        events.append(event)
    names = [event["event"] for event in events]
    assert "interrupt" in names

    @pytest.mark.asyncio
    async def test_astream_auto_resume_branch(service):
        """auto_resume フラグが有効な場合に自動再開イベントが発行されることを検証するテスト。

        Args:
            service (tuple[workflow.WorkflowService, DummyGraph]): テスト用に差し替えたサービスとグラフのペア。
        """

        svc, _ = service
        events = []
        async for event in svc._astream(
            {"user_input": "topic"},
            thread_id="manual-thread",
            auto_resume=True,
        ):
            events.append(event)

        assert any(event.get("event") == "auto_resume" for event in events)

    @pytest.mark.asyncio
    async def test_astream_predicate_blocks_and_auto_resumes(
        service, monkeypatch: pytest.MonkeyPatch
    ):
        """人手介入が不許可の場合に auto_resume 分岐で Command が起動することを検証するテスト。

        Args:
            service (tuple[workflow.WorkflowService, DummyGraph]): テスト用に差し替えたサービスとグラフのペア。
            monkeypatch (pytest.MonkeyPatch): Command を例外送出クラスへ差し替えるフィクスチャ。
        """

        svc, _ = service

        class ExplodingCommand:
            def __init__(self, **kwargs):
                raise RuntimeError("boom")

        monkeypatch.setattr(workflow_service_module, "Command", ExplodingCommand)

        call_count = {"value": 0}

        def fake_extract(_event):
            if call_count["value"] == 0:
                call_count["value"] += 1
                return SimpleInterrupt("forced", "代替")
            return None

        svc._extract_interrupt = fake_extract  # type: ignore[assignment]

        agen = svc._astream(
            {"user_input": "topic"},
            thread_id="manual-thread",
            auto_resume=False,
            interrupt_predicate=lambda _: False,
        )

        try:
            await agen.__anext__()  # on_chain_start
            await agen.__anext__()  # on_chain_stream
            auto_event = await agen.__anext__()
            assert auto_event.get("event") == "auto_resume"
            with pytest.raises(RuntimeError):
                await agen.__anext__()
        finally:
            await agen.aclose()

        assert call_count["value"] == 1


@pytest.mark.asyncio
async def test_astream_marks_error_events(service):
    """_astream がエラーイベントを検出してエラーレベルを付与することを検証するテスト。

    Args:
        service (tuple[workflow.WorkflowService, DummyGraph]): テスト用に差し替えたサービスとグラフのペア。
    """
    svc, _ = service
    events = []
    async for event in svc._astream(
        {"user_input": "error"}, thread_id="error-thread", auto_resume=False
    ):
        events.append(event)

    assert events[0]["level"] == "error"
    assert "code" in events[0]["message"]
