"""Deep Researchワークフローの実行管理ロジック。"""

from __future__ import annotations

import json
import os
import uuid
from dataclasses import dataclass
from typing import Any, AsyncGenerator, Awaitable, Callable, Dict, Optional

from langchain_core.runnables import RunnableConfig
from langgraph.types import Command, Interrupt

from ..agent import OSSDeepResearchAgent

_STREAM_VERSION = "v1"
_DEFAULT_RECURSION_LIMIT = 100


class WorkflowError(Exception):
    """ワークフロー操作時に発生する例外の基底クラス。"""


class StateNotFoundError(WorkflowError):
    """指定したスレッドの状態が見つからない場合に送出する。"""


class HitlNotEnabledError(WorkflowError):
    """HITL モードが無効なスレッドに対して操作を行った場合に送出する。"""


class InterruptNotFoundError(WorkflowError):
    """保留中割り込みが存在しない場合に送出する。"""


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


class WorkflowService:
    """Deep Researchワークフロー実行を統括するサービス。"""

    def __init__(self) -> None:
        """サービスを初期化し、LangGraphエージェントを構築する。"""

        self._agent = OSSDeepResearchAgent()
        self._graph = self._agent.get_compiled_graph()
        self._pending_interrupts: dict[str, Interrupt] = {}
        self._hitl_threads: set[str] = set()
        self._recursion_limit = self._load_recursion_limit()

    # 公開API ---------------------------------------------------------------

    def create_thread_id(self) -> str:
        """新しいスレッドIDを生成する。"""

        return str(uuid.uuid4())

    async def start_research(
        self,
        *,
        thread_id: str,
        query: str,
        event_consumer: Callable[[Dict[str, Any]], Awaitable[None]] | None = None,
    ) -> RunOutcome:
        """ワークフローを開始し、必ずHITL割り込みポイントまで実行する。"""

        self._register_hitl_thread(thread_id)
        initial_payload: Dict[str, Any] = {"user_input": query}
        events, pending, finished, snapshot = await self._run_until_pause(
            initial_payload,
            thread_id=thread_id,
            auto_resume=False,
            interrupt_predicate=self._is_plan_edit_interrupt,
            event_consumer=event_consumer,
        )
        self._record_post_run(thread_id, pending, finished)
        state = self._serialize_state(thread_id, snapshot)
        status = "completed" if finished else "pending_human"
        interrupt_dict = self._serialize_interrupt(pending) if pending else None
        return RunOutcome(
            status=status, state=state, events=events, interrupt=interrupt_dict
        )

    async def resume_research(
        self,
        *,
        thread_id: str,
        decision: str,
        plan_update: Any | None,
        event_consumer: Callable[[Dict[str, Any]], Awaitable[None]] | None = None,
    ) -> RunOutcome:
        """保留中割り込みへの回答を用いてワークフローを再開する。"""

        if not self._is_hitl_thread(thread_id):
            raise HitlNotEnabledError("このスレッドはHITLモードで開始されていません。")

        pending = self._get_pending_interrupt(thread_id)
        if pending is None:
            raise InterruptNotFoundError("待機中の割り込みは見つかりません。")

        command_kwargs: Dict[str, Any] = {"resume": {pending.id: decision}}
        if plan_update is not None:
            command_kwargs["update"] = {"research_plan": plan_update}

        events, next_pending, finished, snapshot = await self._run_until_pause(
            Command(**command_kwargs),
            thread_id=thread_id,
            auto_resume=False,
            interrupt_predicate=self._is_plan_edit_interrupt,
            event_consumer=event_consumer,
        )
        self._record_post_run(thread_id, next_pending, finished)

        state = self._serialize_state(thread_id, snapshot)
        status = "completed" if finished else "pending_human"
        interrupt_dict = (
            self._serialize_interrupt(next_pending) if next_pending else None
        )
        return RunOutcome(
            status=status, state=state, events=events, interrupt=interrupt_dict
        )

    def get_state(self, thread_id: str) -> StateSnapshot:
        """スレッドIDに紐づく最新状態を取得する。"""

        snapshot = self._graph.get_state(self._graph_config(thread_id))
        if snapshot is None:
            raise StateNotFoundError("指定したスレッドの状態が見つかりません。")

        pending = self._get_pending_interrupt(thread_id)
        status = "pending_human"
        if not pending:
            status = "completed" if self._is_run_finished(snapshot) else "running"

        state = self._serialize_state(thread_id, snapshot)
        interrupt_dict = self._serialize_interrupt(pending) if pending else None
        return StateSnapshot(
            status=status, state=state, pending_interrupt=interrupt_dict
        )

    def diagnostics(self) -> Dict[str, Any]:
        """サービス全体の診断情報を取得する。"""

        return {
            "active_threads": len(self._hitl_threads),
            "pending_interrupts": len(self._pending_interrupts),
            "recursion_limit": self._recursion_limit,
        }

    def list_active_threads(self) -> list[str]:
        """現在アクティブなスレッドID一覧を返す。"""

        return sorted(self._hitl_threads)

    def list_pending_interrupts(self) -> list[str]:
        """割り込み回答待ちのスレッドID一覧を返す。"""

        return sorted(self._pending_interrupts.keys())

    async def stream_events(
        self,
        *,
        thread_id: str,
        query: str,
        auto_resume: bool = True,
        interrupt_predicate: Callable[[Interrupt], bool] | None = None,
    ) -> AsyncGenerator[str, None]:
        """ワークフロー実行イベントをストリームとして返す。"""

        initial_payload: Dict[str, Any] = {"user_input": query}
        async for event in self._astream(
            initial_payload,
            thread_id=thread_id,
            auto_resume=auto_resume,
            interrupt_predicate=interrupt_predicate,
        ):
            yield self._format_sse(event)

        final_state = self._serialize_state(thread_id)
        yield self._format_sse(
            {
                "event": "state_snapshot",
                "name": "final_state",
                "data": {"thread_id": thread_id, "state": final_state},
            }
        )

    def render_event(self, event: Dict[str, Any]) -> str:
        """任意のイベント辞書をSSEフレーム文字列へ変換する。"""

        return self._format_sse(event)

    # 内部ユーティリティ ---------------------------------------------------

    def _graph_config(self, thread_id: str) -> RunnableConfig:
        return {
            "configurable": {"thread_id": thread_id},
            "recursion_limit": self._recursion_limit,
        }

    def _load_recursion_limit(self) -> int:
        raw_value = os.getenv("GRAPH_RECURSION_LIMIT")
        try:
            limit = (
                int(raw_value) if raw_value is not None else _DEFAULT_RECURSION_LIMIT
            )
        except (TypeError, ValueError):
            limit = _DEFAULT_RECURSION_LIMIT
        return max(limit, 1)

    def _register_hitl_thread(self, thread_id: str) -> None:
        self._hitl_threads.add(thread_id)
        self._pending_interrupts.pop(thread_id, None)

    def _record_post_run(
        self,
        thread_id: str,
        pending: Optional[Interrupt],
        finished: bool,
    ) -> None:
        if pending and not finished:
            self._hitl_threads.add(thread_id)
            self._pending_interrupts[thread_id] = pending
            return
        self._hitl_threads.discard(thread_id)
        self._pending_interrupts.pop(thread_id, None)

    def _is_hitl_thread(self, thread_id: str) -> bool:
        return thread_id in self._hitl_threads

    def _get_pending_interrupt(self, thread_id: str) -> Optional[Interrupt]:
        if not self._is_hitl_thread(thread_id):
            return None
        return self._pending_interrupts.get(thread_id)

    def _serialize_interrupt(
        self, interrupt: Interrupt | None
    ) -> Dict[str, Any] | None:
        if interrupt is None:
            return None
        return {"id": interrupt.id, "value": interrupt.value}

    def _extract_interrupt(self, event: Any) -> Optional[Interrupt]:
        data = event.get("data")
        if not isinstance(data, dict):
            return None

        payload: Any | None = None
        if event.get("event") == "on_chain_stream":
            payload = data.get("chunk")
        elif event.get("event") == "on_chain_end":
            payload = data.get("output")

        if isinstance(payload, dict) and "__interrupt__" in payload:
            interrupts = payload["__interrupt__"]
            if isinstance(interrupts, (list, tuple)) and interrupts:
                candidate = interrupts[-1]
                if isinstance(candidate, Interrupt):
                    return candidate
        return None

    def _sanitize_event(self, event: Any) -> Dict[str, Any]:
        if isinstance(event, dict):
            return {key: self._convert_model(value) for key, value in event.items()}
        return {"event": "message", "data": self._convert_model(event)}

    def _convert_model(self, obj: Any) -> Any:
        if hasattr(obj, "model_dump"):
            return obj.model_dump()
        if isinstance(obj, Interrupt):
            return {"id": obj.id, "value": obj.value}
        if isinstance(obj, dict):
            return {k: self._convert_model(v) for k, v in obj.items()}
        if isinstance(obj, (list, tuple)):
            return [self._convert_model(v) for v in obj]
        if isinstance(obj, (str, int, float, bool)) or obj is None:
            return obj
        return str(obj)

    def _serialize_state(
        self, thread_id: str, snapshot: Any | None = None
    ) -> Dict[str, Any]:
        if snapshot is None:
            snapshot = self._graph.get_state(self._graph_config(thread_id))
        if snapshot is None:
            raise StateNotFoundError("指定したスレッドの状態が見つかりません。")
        values = getattr(snapshot, "values", {})
        return {k: self._convert_model(v) for k, v in dict(values).items()}

    def _is_plan_edit_interrupt(self, interrupt: Interrupt) -> bool:
        prompt = getattr(interrupt, "value", "")
        if isinstance(prompt, str) and "編集しますか" in prompt:
            return True
        interrupt_id = getattr(interrupt, "id", "")
        return (
            isinstance(interrupt_id, str)
            and "_research_plan_human_judge" in interrupt_id
        )

    def _is_run_finished(self, snapshot: Any | None) -> bool:
        if snapshot is None:
            return False
        return not getattr(snapshot, "next", None)

    async def _run_until_pause(
        self,
        payload: Any,
        *,
        thread_id: str,
        auto_resume: bool,
        interrupt_predicate: Callable[[Interrupt], bool] | None = None,
        event_consumer: Callable[[Dict[str, Any]], Awaitable[None]] | None = None,
    ) -> tuple[list[Dict[str, Any]], Optional[Interrupt], bool, Any | None]:
        config = self._graph_config(thread_id)
        current_payload: Any = payload
        collected_events: list[Dict[str, Any]] = []

        while True:
            pending: Interrupt | None = None
            async for event in self._graph.astream_events(
                current_payload, config=config, version=_STREAM_VERSION
            ):
                sanitized = self._sanitize_event(event)
                if event_consumer:
                    await event_consumer(sanitized)
                collected_events.append(sanitized)
                pending = self._extract_interrupt(event)
                if pending:
                    break

            snapshot = self._graph.get_state(config)
            finished = self._is_run_finished(snapshot)

            if pending:
                allowed = interrupt_predicate(pending) if interrupt_predicate else True
                if auto_resume or not allowed:
                    auto_event = {
                        "event": "auto_resume",
                        "name": "human_judge",
                        "data": {"decision": "n", "thread_id": thread_id},
                    }
                    collected_events.append(self._sanitize_event(auto_event))
                    current_payload = Command(resume={pending.id: "n"})
                    continue
                return collected_events, pending, finished, snapshot

            return collected_events, None, finished, snapshot

    async def _astream(
        self,
        payload: Any,
        *,
        thread_id: str,
        auto_resume: bool,
        interrupt_predicate: Callable[[Interrupt], bool] | None = None,
    ) -> AsyncGenerator[Any, None]:
        config = self._graph_config(thread_id)
        current_payload: Any = payload

        while True:
            pending: Interrupt | None = None
            async for event in self._graph.astream_events(
                current_payload, config=config, version=_STREAM_VERSION
            ):
                yield self._sanitize_event(event)
                pending = self._extract_interrupt(event)
                if pending:
                    break
            if not pending:
                break

            allowed = interrupt_predicate(pending) if interrupt_predicate else True
            if auto_resume or not allowed:
                yield {
                    "event": "auto_resume",
                    "name": "human_judge",
                    "data": {"decision": "n", "thread_id": thread_id},
                }
                current_payload = Command(resume={pending.id: "n"})
                continue

            yield {
                "event": "interrupt",
                "name": pending.id,
                "data": self._serialize_interrupt(pending),
            }
            return

    def _format_sse(self, event: Dict[str, Any]) -> str:
        payload = json.dumps(event, default=self._convert_model, ensure_ascii=False)
        event_type = event.get("event", "message")
        return f"event: {event_type}\ndata: {payload}\n\n"


workflow_service = WorkflowService()
"""アプリ全体で共有するワークフローサービスシングルトン。"""
