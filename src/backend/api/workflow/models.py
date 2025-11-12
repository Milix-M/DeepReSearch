"""Workflowサービスで利用するデータモデル。"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict


@dataclass
class RunOutcome:
    """ワークフロー実行結果を表現するデータクラス。"""

    status: str
    state: Dict[str, Any]
    events: list[Dict[str, Any]]
    interrupt: Dict[str, Any] | None


@dataclass
class StateSnapshot:
    """スレッド状態取得結果を表現するデータクラス。"""

    status: str
    state: Dict[str, Any]
    pending_interrupt: Dict[str, Any] | None
