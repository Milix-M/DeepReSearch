import asyncio
import os
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

os.environ.setdefault("OPENAI_API_KEY", "test")
os.environ.setdefault("OPENROUTER_API_KEY", "test")
os.environ.setdefault("ANTHROPIC_API_KEY", "test")
os.environ.setdefault("GOOGLE_API_KEY", "test")

from src.backend.api import main
from src.backend.api.workflow import StateNotFoundError


class StubWorkflowService:
    def __init__(self):
        self.outcomes: list[SimpleNamespace] = []
        self.resume_calls: list[tuple[str, str, object | None]] = []
        self.start_calls: list[tuple[str, str]] = []

    def diagnostics(self):
        return {"ok": True}

    def list_active_threads(self):
        return ["thread-1"]

    def list_pending_interrupts(self):
        return ["thread-1"]

    def create_thread_id(self):
        return "thread-generated"

    async def start_research(self, *, thread_id: str, query: str):
        self.start_calls.append((thread_id, query))
        return self.outcomes.pop(0)

    async def resume_research(self, *, thread_id: str, decision: str, plan_update):
        self.resume_calls.append((thread_id, decision, plan_update))
        return self.outcomes.pop(0)

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
    monkeypatch.setenv("CORS_ALLOW_ORIGINS", "https://a, https://b")
    assert main._resolve_allowed_origins() == ["https://a", "https://b"]

    monkeypatch.delenv("CORS_ALLOW_ORIGINS", raising=False)
    defaults = set(main._resolve_allowed_origins())
    assert "http://localhost:3000" in defaults


@pytest.mark.asyncio
async def test_send_ws_events():
    class StubWebSocket:
        def __init__(self):
            self.sent = []

        async def send_json(self, payload):
            self.sent.append(payload)

    websocket = StubWebSocket()
    events = [{"event": "alpha"}, {"event": "beta"}]
    await main._send_ws_events(websocket, "thread", events)  # type: ignore[arg-type]

    assert websocket.sent[0]["thread_id"] == "thread"
    assert websocket.sent[1]["payload"]["event"] == "beta"


def test_interrupt_from_raw():
    payload = main._interrupt_from_raw({"id": "x", "value": "y"})
    assert payload is not None
    assert payload.id == "x"
    assert main._interrupt_from_raw(None) is None


def test_healthcheck_and_lists(client):
    test_client, service = client
    response = test_client.get("/healthz")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"

    response = test_client.get("/threads")
    body = response.json()
    assert body["active_count"] == 1
    assert service.start_calls == []


def test_get_thread_state(client):
    test_client, _ = client
    response = test_client.get("/threads/thread-1/state")
    assert response.status_code == 200
    assert response.json()["pending_interrupt"]["id"] == "i"

    response = test_client.get("/threads/missing/state")
    assert response.status_code == 404


def test_websocket_research_flow(client):
    test_client, service = client

    service.outcomes = [
        SimpleNamespace(
            status="pending_human",
            events=[{"event": "message", "payload": 1}],
            state={"stage": 1},
            interrupt={"id": "plan", "value": "prompt"},
        ),
        SimpleNamespace(
            status="completed",
            events=[{"event": "message", "payload": 2}],
            state={"stage": 2},
            interrupt=None,
        ),
    ]

    with test_client.websocket_connect("/ws/research") as ws:
        ws.send_json({"query": " run "})
        start = ws.receive_json()
        assert start["type"] == "thread_started"

        event_frame = ws.receive_json()
        assert event_frame["payload"]["event"] == "message"

        interrupt = ws.receive_json()
        assert interrupt["type"] == "interrupt"

        ws.send_json({"decision": "maybe"})
        error = ws.receive_json()
        assert error["type"] == "error"

        interrupt_again = ws.receive_json()
        assert interrupt_again["type"] == "interrupt"

        ws.send_json({"decision": "y", "plan": {"updated": True}})
        event_after_resume = ws.receive_json()
        assert event_after_resume["type"] == "event"
        assert event_after_resume["payload"]["event"] == "message"

        final = ws.receive_json()
        assert final["type"] == "complete"

    assert service.resume_calls == [("thread-generated", "y", {"updated": True})]


def test_websocket_research_blank_query(client):
    test_client, _ = client
    with test_client.websocket_connect("/ws/research") as ws:
        ws.send_json({"query": "   "})
        error = ws.receive_json()
        assert error["type"] == "error"
        with pytest.raises(WebSocketDisconnect) as exc:
            ws.receive_json()
        assert exc.value.code == 4000


def test_websocket_missing_interrupt(client):
    test_client, service = client
    service.outcomes = [
        SimpleNamespace(
            status="pending_human",
            events=[],
            state={"stage": 0},
            interrupt=None,
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
async def test_websocket_research_finally_closes(monkeypatch: pytest.MonkeyPatch):
    class ExplodingService:
        def create_thread_id(self):
            return "tid"

        async def start_research(self, *, thread_id: str, query: str):
            raise RuntimeError("boom")

    class StubWebSocket:
        def __init__(self):
            self.sent = []
            self.closed: list[int] = []
            self.inputs = iter([{"query": "anything"}])

        async def accept(self):
            return None

        async def receive_json(self):
            return next(self.inputs)

        async def send_json(self, payload):
            self.sent.append(payload)

        async def close(self, code: int):
            self.closed.append(code)

        @property
        def application_state(self):
            from starlette.websockets import WebSocketState

            return WebSocketState.CONNECTED

    monkeypatch.setattr(main, "workflow_service", ExplodingService())
    stub = StubWebSocket()

    await main.websocket_research(stub)  # type: ignore[arg-type]

    assert stub.sent[-1]["type"] == "error"
    assert stub.closed.count(1000) >= 1
