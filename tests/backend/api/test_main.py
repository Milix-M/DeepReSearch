import os
from dataclasses import dataclass
from types import SimpleNamespace

os.environ.setdefault("OPENROUTER_API_KEY", "test")
os.environ.setdefault("OPENAI_API_KEY", "test")

import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect, WebSocketState

from src.backend.api import main
from src.backend.api.workflow import StateNotFoundError


@dataclass
class Script:
    events: list[dict]
    outcome: SimpleNamespace


class StubWorkflowService:

    def __init__(self):
        self.start_scripts: list[Script] = []
        self.resume_scripts: list[Script] = []
        self.start_calls: list[tuple[str, str]] = []
        self.resume_calls: list[tuple[str, str, object | None]] = []
        self.created = 0

    def diagnostics(self) -> dict:
        return {"ok": True}

    def list_active_threads(self) -> list[str]:
        return ["thread-a"]

    def list_pending_interrupts(self) -> list[str]:
        return ["thread-a"]

    def create_thread_id(self) -> str:
        self.created += 1
        return f"thread-{self.created}"

    async def start_research(self, *, thread_id: str, query: str, event_consumer=None):
        self.start_calls.append((thread_id, query))
        script = self.start_scripts.pop(0)
        if event_consumer:
            for event in script.events:
                await event_consumer(event)
        return script.outcome

    async def resume_research(
        self,
        *,
        thread_id: str,
        decision: str,
        plan_update,
        event_consumer=None,
    ):
        self.resume_calls.append((thread_id, decision, plan_update))
        script = self.resume_scripts.pop(0)
        if event_consumer:
            for event in script.events:
                await event_consumer(event)
        return script.outcome

    def get_state(self, thread_id: str):
        if thread_id == "missing":
            raise StateNotFoundError("not found")
        return SimpleNamespace(
            status="pending_human",
            state={"value": 1},
            pending_interrupt={"id": "i", "value": "v"},
        )


@pytest.fixture
def client(monkeypatch: pytest.MonkeyPatch):
    service = StubWorkflowService()
    monkeypatch.setattr(main, "workflow_service", service)
    return TestClient(main.app), service


def test_resolve_allowed_origins(monkeypatch: pytest.MonkeyPatch):
    """CORS 設定の環境変数を解析し、期待した既定値を返すことを検証するテスト。

    Args:
        monkeypatch (pytest.MonkeyPatch): 環境変数を操作して分岐を切り替えるフィクスチャ。
    """
    monkeypatch.setenv("CORS_ALLOW_ORIGINS", "https://a, https://b")
    assert main._resolve_allowed_origins() == ["https://a", "https://b"]

    monkeypatch.delenv("CORS_ALLOW_ORIGINS", raising=False)
    defaults = set(main._resolve_allowed_origins())
    assert "http://localhost:3000" in defaults


def test_interrupt_from_raw_and_none():
    """辞書形式の割り込みデータから Interrupt オブジェクトを生成し、None を許容することを検証するテスト。"""
    payload = main._interrupt_from_raw({"id": "x", "value": "y"})
    assert payload is not None and payload.id == "x"
    assert main._interrupt_from_raw(None) is None


def test_extract_event_error_message_variations():
    """イベントペイロードからエラーメッセージを抽出するヘルパーの各分岐を検証するテスト。"""
    assert main._extract_event_error_message({"message": "error"}) == "error"
    assert (
        main._extract_event_error_message({"data": {"message": "payload"}}) == "payload"
    )
    assert (
        main._extract_event_error_message({"event": "failure", "data": {"other": 1}})
        == "処理中にエラーが発生しました。"
    )


def test_health_and_thread_endpoints(client):
    """ヘルスチェックとスレッド一覧エンドポイントが期待した統計を返すことを検証するテスト。

    Args:
        client (tuple[TestClient, StubWorkflowService]): API クライアントとスタブサービスのペア。
    """
    test_client, service = client
    response = test_client.get("/healthz")
    assert response.status_code == 200
    assert response.json()["details"] == {"ok": True}

    response = test_client.get("/threads")
    body = response.json()
    assert body["active_count"] == 1
    assert body["pending_count"] == 1
    assert service.start_calls == []


def test_get_thread_state(client):
    """スレッド状態取得 API が存在するスレッドの詳細と未検出時の 404 を返すことを検証するテスト。

    Args:
        client (tuple[TestClient, StubWorkflowService]): API クライアントとスタブサービスのペア。
    """
    test_client, _ = client
    response = test_client.get("/threads/thread-a/state")
    assert response.status_code == 200
    assert response.json()["pending_interrupt"]["id"] == "i"

    missing = test_client.get("/threads/missing/state")
    assert missing.status_code == 404


def test_websocket_flow_handles_interrupt_and_resume(client):
    """WebSocket フローが割り込みと再開を順序通り転送し、サービス呼び出しを追跡することを検証するテスト。

    Args:
        client (tuple[TestClient, StubWorkflowService]): API クライアントとスタブサービスのペア。
    """
    test_client, service = client

    service.start_scripts = [
        Script(
            events=[
                {
                    "event": "alpha",
                    "level": "error",
                    "data": {"message": "first"},
                }
            ],
            outcome=SimpleNamespace(
                status="pending_human",
                events=[{"event": "alpha"}],
                state={"stage": 1},
                interrupt={"id": "plan", "value": "調査計画を編集しますか"},
            ),
        )
    ]
    service.resume_scripts = [
        Script(
            events=[{"event": "beta", "data": {"message": "second"}}],
            outcome=SimpleNamespace(
                status="completed",
                events=[{"event": "beta"}],
                state={"stage": 2},
                interrupt=None,
            ),
        )
    ]

    with test_client.websocket_connect("/ws/research") as ws:
        ws.send_json({"query": " run "})
        started = ws.receive_json()
        assert started["type"] == "thread_started"

        forwarded = ws.receive_json()
        assert forwarded["payload"]["event"] == "alpha"

        forwarded_error = ws.receive_json()
        assert forwarded_error["type"] == "error"
        assert forwarded_error["message"] == "first"

        interrupt = ws.receive_json()
        assert interrupt["type"] == "interrupt"

        ws.send_json({"decision": "maybe"})
        retry_error = ws.receive_json()
        assert retry_error["type"] == "error"

        second_interrupt = ws.receive_json()
        assert second_interrupt["type"] == "interrupt"

        ws.send_json({"decision": "y", "plan": {"updated": True}})
        resumed = ws.receive_json()
        assert resumed["payload"]["event"] == "beta"

        completed = ws.receive_json()
        assert completed["type"] == "complete"

    assert service.start_calls[0][1].strip() == "run"
    assert service.resume_calls == [("thread-1", "y", {"updated": True})]


def test_websocket_blank_query_returns_error(client):
    """空問い合わせで WebSocket がエラーを返し接続を閉じることを検証するテスト。

    Args:
        client (tuple[TestClient, StubWorkflowService]): API クライアントとスタブサービスのペア。
    """
    test_client, _ = client
    with test_client.websocket_connect("/ws/research") as ws:
        ws.send_json({"query": "   "})
        error = ws.receive_json()
        assert error["type"] == "error"
        with pytest.raises(WebSocketDisconnect) as exc:
            ws.receive_json()
        assert exc.value.code == 4000


def test_websocket_missing_interrupt_triggers_close(client):
    """割り込みが返らないケースで WebSocket がエラーコード付きで終了することを検証するテスト。

    Args:
        client (tuple[TestClient, StubWorkflowService]): API クライアントとスタブサービスのペア。
    """
    test_client, service = client
    service.start_scripts = [
        Script(
            events=[],
            outcome=SimpleNamespace(
                status="pending_human",
                events=[],
                state={"stage": 0},
                interrupt=None,
            ),
        )
    ]

    with test_client.websocket_connect("/ws/research") as ws:
        ws.send_json({"query": "fail"})
        ws.receive_json()
        error = ws.receive_json()
        assert error["type"] == "error"
        with pytest.raises(WebSocketDisconnect) as exc:
            ws.receive_json()
        assert exc.value.code == 1011


@pytest.mark.asyncio
async def test_websocket_exception_path_closes_connection(
    monkeypatch: pytest.MonkeyPatch,
):
    """start_research 中の例外発生時にエラー通知と正常クローズが行われることを検証するテスト。

    Args:
        monkeypatch (pytest.MonkeyPatch): ワークフローサービスを爆発するダミーに差し替えるフィクスチャ。
    """

    class ExplodingService:

        def create_thread_id(self) -> str:
            return "tid"

        async def start_research(
            self, *, thread_id: str, query: str, event_consumer=None
        ):
            raise RuntimeError("boom")

    class StubWebSocket:
        def __init__(self):
            self.outputs: list[dict] = []
            self.closes: list[int] = []
            self.inputs = iter([{"query": "anything"}])

        async def accept(self):
            return None

        async def receive_json(self):
            return next(self.inputs)

        async def send_json(self, payload):
            self.outputs.append(payload)

        async def close(self, code: int):
            self.closes.append(code)

        @property
        def application_state(self):
            return WebSocketState.CONNECTED

    monkeypatch.setattr(main, "workflow_service", ExplodingService())
    websocket = StubWebSocket()

    await main.websocket_research(websocket)  # type: ignore[arg-type]

    assert websocket.outputs[-1]["type"] == "error"
    assert 1000 in websocket.closes


@pytest.mark.asyncio
async def test_websocket_disconnect_handled_without_error(
    monkeypatch: pytest.MonkeyPatch,
):
    """初回受信時にクライアント切断が発生しても追加送信やクローズを行わないことを検証するテスト。

    Args:
        monkeypatch (pytest.MonkeyPatch): ワークフローサービスをテスト用スタブへ差し替えるフィクスチャ。
    """

    class DisconnectingWebSocket:
        def __init__(self):
            self.accepted = False
            self.sent: list[dict] = []
            self.closed: list[int] = []

        async def accept(self):
            self.accepted = True

        async def receive_json(self):
            raise WebSocketDisconnect(code=1001)

        async def send_json(self, payload):
            self.sent.append(payload)

        async def close(self, code: int):
            self.closed.append(code)

        @property
        def application_state(self):
            return WebSocketState.DISCONNECTED

    monkeypatch.setattr(main, "workflow_service", StubWorkflowService())
    websocket = DisconnectingWebSocket()

    await main.websocket_research(websocket)  # type: ignore[arg-type]

    assert websocket.accepted is True
    assert websocket.sent == []
    assert websocket.closed == []
