"""Deep ResearchワークフローをFastAPIで公開するエントリーポイント。"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from starlette.websockets import WebSocketState

from .schemas import HealthResponse, InterruptPayload, StateResponse, ThreadListResponse
from .workflow import StateNotFoundError, workflow_service

app = FastAPI(title="Deep Research API", version="1.0.0")


async def _send_ws_events(
    websocket: WebSocket, thread_id: str, events: list[Dict[str, Any]]
) -> None:
    """WebSocketへ逐次イベントを送信する。"""

    for event in events:
        await websocket.send_json(
            {
                "type": "event",
                "thread_id": thread_id,
                "payload": event,
            }
        )


def _interrupt_from_raw(raw: Dict[str, Any] | None) -> InterruptPayload | None:
    if not raw:
        return None
    return InterruptPayload.model_validate(raw)


@app.get("/healthz", response_model=HealthResponse, tags=["system"])
async def healthcheck() -> HealthResponse:
    """システムの稼働状況を返すヘルスチェック。"""

    diagnostics = workflow_service.diagnostics()
    return HealthResponse(
        status="ok",
        timestamp=datetime.now(timezone.utc),
        details=diagnostics,
    )


@app.get("/threads", response_model=ThreadListResponse, tags=["workflow"])
async def list_threads() -> ThreadListResponse:
    """アクティブなスレッドおよび割り込み待ちスレッドの一覧を返す。"""

    active = workflow_service.list_active_threads()
    pending = workflow_service.list_pending_interrupts()
    return ThreadListResponse(
        active_thread_ids=active,
        pending_interrupt_ids=pending,
        active_count=len(active),
        pending_count=len(pending),
    )


@app.get(
    "/threads/{thread_id}/state",
    response_model=StateResponse,
    tags=["workflow"],
)
async def get_thread_state(thread_id: str) -> StateResponse:
    """スレッドの最新状態スナップショットを取得する。"""

    try:
        snapshot = workflow_service.get_state(thread_id)
    except StateNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    return StateResponse(
        thread_id=thread_id,
        status=snapshot.status,
        state=snapshot.state,
        pending_interrupt=_interrupt_from_raw(snapshot.pending_interrupt),
    )


@app.websocket("/ws/research")
async def websocket_research(websocket: WebSocket) -> None:
    """WebSocket経由でHITL対応のリサーチ実行を提供する。"""

    await websocket.accept()
    thread_id: str | None = None

    try:
        initial_payload = await websocket.receive_json()
        query = (initial_payload.get("query") or "").strip()
        if not query:
            await websocket.send_json({"type": "error", "message": "query が空です。"})
            await websocket.close(code=4000)
            return

        thread_id = workflow_service.create_thread_id()
        await websocket.send_json({"type": "thread_started", "thread_id": thread_id})

        outcome = await workflow_service.start_research(
            thread_id=thread_id,
            query=query,
        )
        await _send_ws_events(websocket, thread_id, outcome.events)

        while True:
            if outcome.status == "completed":
                await websocket.send_json(
                    {
                        "type": "complete",
                        "thread_id": thread_id,
                        "state": outcome.state,
                    }
                )
                await websocket.close(code=1000)
                return

            interrupt_payload = _interrupt_from_raw(outcome.interrupt)
            if not interrupt_payload:
                await websocket.send_json(
                    {
                        "type": "error",
                        "message": "割り込み情報が取得できませんでした。",
                    }
                )
                await websocket.close(code=1011)
                return

            await websocket.send_json(
                {
                    "type": "interrupt",
                    "thread_id": thread_id,
                    "interrupt": interrupt_payload.model_dump(),
                }
            )

            resume_payload = await websocket.receive_json()
            decision = (resume_payload.get("decision") or "").lower()
            if decision not in {"y", "n"}:
                await websocket.send_json(
                    {
                        "type": "error",
                        "message": "decision は 'y' または 'n' を指定してください。",
                    }
                )
                continue

            plan_update = resume_payload.get("plan")
            outcome = await workflow_service.resume_research(
                thread_id=thread_id,
                decision=decision,
                plan_update=plan_update,
            )
            await _send_ws_events(websocket, thread_id, outcome.events)

    except WebSocketDisconnect:  # pragma: no cover - 切断時
        return
    except Exception as exc:  # pragma: no cover - 想定外エラー
        if websocket.application_state == WebSocketState.CONNECTED:
            await websocket.send_json({"type": "error", "message": str(exc)})
            await websocket.close(code=1011)
    finally:
        if websocket.application_state == WebSocketState.CONNECTED:
            await websocket.close(code=1000)
