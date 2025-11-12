"""Deep ResearchワークフローをFastAPIで公開するエントリーポイント。"""

from __future__ import annotations

import logging
import os
from datetime import datetime, timezone
from typing import Any, Dict

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from starlette.websockets import WebSocketState

from .schemas import HealthResponse, InterruptPayload, StateResponse, ThreadListResponse
from .workflow import StateNotFoundError, WorkflowService

workflow_service = WorkflowService()
app = FastAPI(title="Deep Research API", version="1.0.0")

_DEFAULT_ALLOWED_ORIGINS = {
    "http://localhost:3000",
    "http://127.0.0.1:3000",
}

# Uvicorn の標準エラーロガー配下にぶら下げて、Docker コンソールへ確実に流す。
logger = logging.getLogger("uvicorn.error").getChild("deep_research.api")
logger.setLevel(logging.INFO)
logger.propagate = True


def _resolve_allowed_origins() -> list[str]:
    """CORS許可オリジンを環境変数から解決する。

    Returns:
        list[str]: 許可するオリジンのリスト。環境変数が未設定の場合はデフォルト値を返す。
    """

    raw_value = os.getenv("CORS_ALLOW_ORIGINS", "")
    # 環境変数はカンマ区切りを想定、空要素を除外しつつ整理
    candidates = [origin.strip() for origin in raw_value.split(",") if origin.strip()]
    if candidates:
        return candidates
    return list(_DEFAULT_ALLOWED_ORIGINS)


app.add_middleware(
    CORSMiddleware,
    allow_origins=_resolve_allowed_origins(),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def _interrupt_from_raw(raw: Dict[str, Any] | None) -> InterruptPayload | None:
    """未加工データから割り込みペイロードを生成する。

    Args:
        raw (Dict[str, Any] | None): ワークフローから返された割り込みデータ。

    Returns:
        InterruptPayload | None: バリデーションに成功した割り込みペイロード。入力が不正な場合は `None`。
    """
    if not raw:
        return None
    return InterruptPayload.model_validate(raw)


def _extract_event_error_message(event: Dict[str, Any]) -> str:
    """イベントペイロードから代表的なエラーメッセージを抽出する。

    Args:
        event (Dict[str, Any]): ワークフローから受け取ったイベントペイロード。

    Returns:
        str: 抽出したエラーメッセージ。候補が存在しない場合は汎用的なメッセージを返す。
    """
    message = event.get("message")
    if isinstance(message, str) and message:
        return message

    payload = event.get("data") or event.get("payload")
    if isinstance(payload, dict):
        for key in ("message", "error", "text", "details"):
            value = payload.get(key)
            if isinstance(value, str) and value:
                return value

    return "処理中にエラーが発生しました。"


@app.get("/healthz", response_model=HealthResponse, tags=["system"])
async def healthcheck() -> HealthResponse:
    """システムの稼働状況を返すヘルスチェック。

    Returns:
        HealthResponse: システムステータスと診断情報を含むレスポンス。
    """

    diagnostics = workflow_service.diagnostics()
    return HealthResponse(
        status="ok",
        timestamp=datetime.now(timezone.utc),
        details=diagnostics,
    )


@app.get("/threads", response_model=ThreadListResponse, tags=["workflow"])
async def list_threads() -> ThreadListResponse:
    """アクティブなスレッドおよび割り込み待ちスレッドの一覧を返す。

    Returns:
        ThreadListResponse: スレッドIDと件数を含むレスポンスデータ。
    """

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
    """スレッドの最新状態スナップショットを取得する。

    Args:
        thread_id (str): 状態を取得したいスレッドID。

    Returns:
        StateResponse: スレッドのステータス、状態、割り込み情報を含むレスポンス。

    Raises:
        HTTPException: スレッドが見つからない場合に ``404`` を投げる。
    """

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
    """WebSocket経由でHITL対応のリサーチ実行を提供する。

    Args:
        websocket (WebSocket): クライアント接続を表すWebSocketインスタンス。

    Returns:
        None: このエンドポイントはレスポンスボディを返さない。

    Raises:
        WebSocketDisconnect: クライアント切断時に内部的に発生する。
        Exception: 想定外のエラーが発生した場合に送信し、接続を終了する。
    """

    # WebSocket接続を確立し、スレッドIDを後続処理で共有する。
    await websocket.accept()
    thread_id: str | None = None
    close_reason = "initialized"

    try:
        # クライアントから初期クエリを受信し、空文字列でないことを確認する。
        initial_payload = await websocket.receive_json()
        query = (initial_payload.get("query") or "").strip()
        if not query:
            logger.warning("WebSocket closing due to empty query payload")
            close_reason = "invalid_query"
            await websocket.send_json({"type": "error", "message": "query が空です。"})
            await websocket.close(code=4000)
            return

        # 新しいスレッドを生成し、クライアントへ開始イベントを通知する。
        thread_id = workflow_service.create_thread_id()
        logger.info(
            "WebSocket session started [thread_id=%s, query=%s]",
            thread_id,
            query[:200],
        )
        await websocket.send_json({"type": "thread_started", "thread_id": thread_id})

        async def forward_event(event: Dict[str, Any]) -> None:
            # ワークフローからのイベントをそのままフロントに中継する。
            event_name = event.get("event")
            logger.debug(
                "Forwarding workflow event [thread_id=%s, event=%s]",
                thread_id,
                event_name,
            )
            await websocket.send_json(
                {
                    "type": "event",
                    "thread_id": thread_id,
                    "payload": event,
                }
            )
            if event.get("level") == "error":
                error_message = _extract_event_error_message(event)
                logger.error(
                    "Workflow error event forwarded [thread_id=%s, event=%s]: %s",
                    thread_id,
                    event.get("event"),
                    error_message,
                )
                await websocket.send_json(
                    {
                        "type": "error",
                        "thread_id": thread_id,
                        "message": error_message,
                    }
                )

        # ワークフローを開始し、最初の割り込みまたは完了まで待機する。
        outcome = await workflow_service.start_research(
            thread_id=thread_id,
            query=query,
            event_consumer=forward_event,
        )
        logger.info(
            "Workflow start completed [thread_id=%s, status=%s, events=%d, interrupt=%s]",
            thread_id,
            outcome.status,
            len(outcome.events),
            bool(outcome.interrupt),
        )

        while True:
            if outcome.status == "completed":
                logger.info("Thread completed [thread_id=%s]", thread_id)
                await websocket.send_json(
                    {
                        "type": "complete",
                        "thread_id": thread_id,
                        "state": outcome.state,
                    }
                )
                close_reason = "completed"
                await websocket.close(code=1000)
                return

            interrupt_payload = _interrupt_from_raw(outcome.interrupt)
            if not interrupt_payload:
                logger.error(
                    "Missing interrupt payload [thread_id=%s, status=%s]",
                    thread_id,
                    outcome.status,
                )
                close_reason = "missing_interrupt"
                await websocket.send_json(
                    {
                        "type": "error",
                        "thread_id": thread_id,
                        "message": "割り込み情報が取得できませんでした。",
                    }
                )
                await websocket.close(code=1011)
                return

            logger.info(
                "Interrupt dispatched [thread_id=%s, interrupt_id=%s]",
                thread_id,
                interrupt_payload.id,
            )
            await websocket.send_json(
                {
                    "type": "interrupt",
                    "thread_id": thread_id,
                    "interrupt": interrupt_payload.model_dump(),
                }
            )

            # クライアント側の意思決定を待ち、承認または再計画を処理する。
            resume_payload = await websocket.receive_json()
            decision = (resume_payload.get("decision") or "").lower()
            if decision not in {"y", "n"}:
                logger.warning(
                    "Invalid decision received [thread_id=%s, decision=%s]",
                    thread_id,
                    resume_payload.get("decision"),
                )
                await websocket.send_json(
                    {
                        "type": "error",
                        "thread_id": thread_id,
                        "message": "decision は 'y' または 'n' を指定してください。",
                    }
                )
                continue

            plan_update = resume_payload.get("plan")
            logger.info(
                "Resuming workflow [thread_id=%s, decision=%s, has_plan_update=%s]",
                thread_id,
                decision,
                plan_update is not None,
            )
            outcome = await workflow_service.resume_research(
                thread_id=thread_id,
                decision=decision,
                plan_update=plan_update,
                event_consumer=forward_event,
            )
            logger.info(
                "Workflow resumed [thread_id=%s, status=%s, events=%d, interrupt=%s]",
                thread_id,
                outcome.status,
                len(outcome.events),
                bool(outcome.interrupt),
            )

    except WebSocketDisconnect:  # pragma: no cover - 切断時
        close_reason = "client_disconnect"
        logger.info("WebSocket disconnected by client [thread_id=%s]", thread_id)
        return
    except Exception as exc:  # pragma: no cover - 想定外エラー
        close_reason = f"exception:{exc.__class__.__name__}"
        logger.exception(
            "Unhandled exception in websocket_research [thread_id=%s]", thread_id
        )
        if websocket.application_state == WebSocketState.CONNECTED:
            error_payload = {"type": "error", "message": str(exc)}
            if thread_id:
                error_payload["thread_id"] = thread_id
            await websocket.send_json(error_payload)
            await websocket.close(code=1011)
    finally:
        if websocket.application_state == WebSocketState.CONNECTED:
            logger.info(
                "Closing WebSocket session [thread_id=%s, reason=%s]",
                thread_id,
                close_reason,
            )
            await websocket.close(code=1000)
        else:
            logger.info(
                "WebSocket session finalized [thread_id=%s, reason=%s]",
                thread_id,
                close_reason,
            )
