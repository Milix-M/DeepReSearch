"""API レイヤーで利用するスキーマ定義モジュール。"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, Literal

from pydantic import BaseModel


class InterruptPayload(BaseModel):
    """HITL 割り込み情報を表現するペイロード。"""

    id: str
    value: Any


class HealthResponse(BaseModel):
    """/healthz エンドポイントのレスポンス。"""

    status: Literal["ok"]
    timestamp: datetime
    details: Dict[str, Any]


class ThreadListResponse(BaseModel):
    """/threads エンドポイントのレスポンス。"""

    active_thread_ids: list[str]
    pending_interrupt_ids: list[str]
    active_count: int
    pending_count: int


class StateResponse(BaseModel):
    """/threads/{thread_id}/state エンドポイントのレスポンス。"""

    thread_id: str
    status: str
    state: Dict[str, Any]
    pending_interrupt: InterruptPayload | None = None
