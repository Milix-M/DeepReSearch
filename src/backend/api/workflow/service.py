"""WorkflowService本体の実装。"""

from __future__ import annotations

import json
import logging
import os
import uuid
from typing import Any, AsyncGenerator, Awaitable, Callable, Dict, Optional

from langchain_core.runnables import RunnableConfig
from langgraph.types import Command, Interrupt

from backend.agent import OSSDeepResearchAgent
from .constants import DEFAULT_RECURSION_LIMIT, STREAM_VERSION
from .errors import (
    HitlNotEnabledError,
    InterruptNotFoundError,
    StateNotFoundError,
)
from .models import RunOutcome, StateSnapshot

logger = logging.getLogger(__name__)


class WorkflowService:
    """Deep Researchワークフロー実行を統括するサービス。"""

    def __init__(self) -> None:
        """サービスを初期化し、LangGraphエージェントを構築する。

        Raises:
            RuntimeError: エージェントの初期化に失敗した場合。
        """

        self._agent = OSSDeepResearchAgent()
        self._graph = self._agent.get_compiled_graph()
        self._pending_interrupts: dict[str, Interrupt] = {}
        self._hitl_threads: set[str] = set()
        self._recursion_limit = self._load_recursion_limit()

    def create_thread_id(self) -> str:
        """新しいスレッドIDを生成する。

        Returns:
            str: UUIDv4形式で生成したスレッドID。
        """

        return str(uuid.uuid4())

    async def start_research(
        self,
        *,
        thread_id: str,
        query: str,
        event_consumer: Callable[[Dict[str, Any]], Awaitable[None]] | None = None,
    ) -> RunOutcome:
        """ワークフローを開始し、HITL割り込み発生位置まで実行する。

        Args:
            thread_id (str): 実行コンテキストを識別するスレッドID。
            query (str): ユーザーからのリサーチ要求テキスト。
            event_consumer (Callable[[Dict[str, Any]], Awaitable[None]] | None):
                実行途中のイベントを逐次処理するコールバック。未指定の場合はイベントを転送しない。

        Returns:
            RunOutcome: 実行結果の状態、イベント群、割り込み情報を含むオブジェクト。
        """

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
        """保留中割り込みへの回答を用いてワークフローを再開する。

        Args:
            thread_id (str): 再開対象のスレッドID。
            decision (str): ヒューマンジャッジの判定結果。``"y"`` または ``"n"`` を想定する。
            plan_update (Any | None): 改訂後の調査計画。判定が ``"n"`` の場合は ``None``。
            event_consumer (Callable[[Dict[str, Any]], Awaitable[None]] | None):
                追加イベントを処理するコールバック。指定しない場合は転送しない。

        Returns:
            RunOutcome: 再開後の進捗、イベント、割り込み状態を表すオブジェクト。

        Raises:
            HitlNotEnabledError: スレッドがHITLモードで開始されていない場合。
            InterruptNotFoundError: 待機中の割り込みが存在しない場合。
        """

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
        """スレッドIDに紐づく最新状態を取得する。

        Args:
            thread_id (str): 状態を確認したいスレッドID。

        Returns:
            StateSnapshot: 現在の状態値、ステータス、割り込み情報をまとめたスナップショット。

        Raises:
            StateNotFoundError: 状態が永続層から取得できなかった場合。
        """

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
        """サービス全体の診断情報を取得する。

        Returns:
            Dict[str, Any]: 稼働中スレッド数や再帰制限などのメトリクス。
        """

        return {
            "active_threads": len(self._hitl_threads),
            "pending_interrupts": len(self._pending_interrupts),
            "recursion_limit": self._recursion_limit,
        }

    def list_active_threads(self) -> list[str]:
        """現在アクティブなスレッドID一覧を返す。

        Returns:
            list[str]: 稼働中ワークフローのスレッドIDを昇順に並べたリスト。
        """

        return sorted(self._hitl_threads)

    def list_pending_interrupts(self) -> list[str]:
        """割り込み回答待ちのスレッドID一覧を返す。

        Returns:
            list[str]: 人手介入待ちのスレッドIDを昇順で並べたリスト。
        """

        return sorted(self._pending_interrupts.keys())

    async def stream_events(
        self,
        *,
        thread_id: str,
        query: str,
        auto_resume: bool = True,
        interrupt_predicate: Callable[[Interrupt], bool] | None = None,
    ) -> AsyncGenerator[str, None]:
        """ワークフロー実行イベントをストリームとして返す。

        Args:
            thread_id (str): イベントを取得したいスレッドID。
            query (str): 初回実行時に投入するリサーチクエリ。
            auto_resume (bool): 割り込み発生時に自動で ``"n"`` 応答を返すかどうか。
            interrupt_predicate (Callable[[Interrupt], bool] | None):
                人手介入が必要か判定するコールバック。未指定の場合は常に許可する。

        Yields:
            str: SSEフォーマットに変換されたイベント文字列。
        """

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

    def _graph_config(self, thread_id: str) -> RunnableConfig:
        """グラフ実行時の設定を生成する。

        Args:
            thread_id (str): 実行対象のスレッドID。

        Returns:
            RunnableConfig: LangGraphに与える設定オブジェクト。
        """

        return {
            "configurable": {"thread_id": thread_id},
            "recursion_limit": self._recursion_limit,
        }

    def _load_recursion_limit(self) -> int:
        """再帰回数の上限値を環境変数から読み込む。

        Returns:
            int: 1以上の再帰上限。環境変数が不正な場合は既定値を返す。
        """

        raw_value = os.getenv("GRAPH_RECURSION_LIMIT")
        try:
            limit = int(raw_value) if raw_value is not None else DEFAULT_RECURSION_LIMIT
        except (TypeError, ValueError):
            limit = DEFAULT_RECURSION_LIMIT
        return max(limit, 1)

    def _register_hitl_thread(self, thread_id: str) -> None:
        """HITL対象スレッドとして登録し、不要な割り込みを初期化する。

        Args:
            thread_id (str): 登録したいスレッドID。
        """

        self._hitl_threads.add(thread_id)
        self._pending_interrupts.pop(thread_id, None)

    def _record_post_run(
        self,
        thread_id: str,
        pending: Optional[Interrupt],
        finished: bool,
    ) -> None:
        """実行後の割り込み状態を記録する。

        Args:
            thread_id (str): スレッドID。
            pending (Optional[Interrupt]): 次回の割り込み。存在しない場合は ``None``。
            finished (bool): 実行が完了したかどうか。
        """

        if pending and not finished:
            self._hitl_threads.add(thread_id)
            self._pending_interrupts[thread_id] = pending
            return
        self._hitl_threads.discard(thread_id)
        self._pending_interrupts.pop(thread_id, None)

    def _is_hitl_thread(self, thread_id: str) -> bool:
        """スレッドがHITL対象か判定する。

        Args:
            thread_id (str): 判定対象のスレッドID。

        Returns:
            bool: HITL対象であれば ``True``。
        """

        return thread_id in self._hitl_threads

    def _get_pending_interrupt(self, thread_id: str) -> Optional[Interrupt]:
        """スレッドに紐づく保留中割り込みを取得する。

        Args:
            thread_id (str): 取得対象のスレッドID。

        Returns:
            Optional[Interrupt]: 保留中割り込み。存在しない場合は ``None``。
        """

        if not self._is_hitl_thread(thread_id):
            return None
        return self._pending_interrupts.get(thread_id)

    def _serialize_interrupt(
        self, interrupt: Interrupt | None
    ) -> Dict[str, Any] | None:
        """割り込みオブジェクトをシリアライズする。

        Args:
            interrupt (Interrupt | None): 変換対象の割り込み。

        Returns:
            Dict[str, Any] | None: ``id`` と ``value`` を持つ辞書。引数が ``None`` の場合は ``None``。
        """

        if interrupt is None:
            return None
        return {"id": interrupt.id, "value": interrupt.value}

    def _extract_interrupt(self, event: Any) -> Optional[Interrupt]:
        """イベントから割り込みを抽出する。

        Args:
            event (Any): LangGraphから受信したイベントデータ。

        Returns:
            Optional[Interrupt]: 抽出した割り込み。含まれない場合は ``None``。
        """

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
        """イベントデータをJSONシリアライズ可能な形へ整形する。

        Args:
            event (Any): 整形対象のイベント。

        Returns:
            Dict[str, Any]: キーと値を安全に変換した辞書。
        """

        if isinstance(event, dict):
            return {key: self._convert_model(value) for key, value in event.items()}
        return {"event": "message", "data": self._convert_model(event)}

    def _convert_model(self, obj: Any) -> Any:
        """各種オブジェクトを辞書またはプリミティブに変換する。

        Args:
            obj (Any): 変換対象のオブジェクト。

        Returns:
            Any: JSON互換の値。
        """

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
        """LangGraphの状態スナップショットを辞書化する。

        Args:
            thread_id (str): 状態を取得するスレッドID。
            snapshot (Any | None): 既に取得済みのスナップショット。未指定時は内部で取得する。

        Returns:
            Dict[str, Any]: JSON互換の状態辞書。

        Raises:
            StateNotFoundError: スレッド状態が取得できなかった場合。
        """

        if snapshot is None:
            snapshot = self._graph.get_state(self._graph_config(thread_id))
        if snapshot is None:
            raise StateNotFoundError("指定したスレッドの状態が見つかりません。")
        values = getattr(snapshot, "values", {})
        return {k: self._convert_model(v) for k, v in dict(values).items()}

    def _is_plan_edit_interrupt(self, interrupt: Interrupt) -> bool:
        """割り込みが調査計画編集に関するものか判定する。

        Args:
            interrupt (Interrupt): 判定対象の割り込み。

        Returns:
            bool: 調査計画編集であれば ``True``。
        """

        prompt = getattr(interrupt, "value", "")
        if isinstance(prompt, str) and "編集しますか" in prompt:
            return True
        interrupt_id = getattr(interrupt, "id", "")
        return (
            isinstance(interrupt_id, str)
            and "_research_plan_human_judge" in interrupt_id
        )

    def _is_run_finished(self, snapshot: Any | None) -> bool:
        """実行が完了しているかどうかを判定する。

        Args:
            snapshot (Any | None): 現在のスナップショット。

        Returns:
            bool: 続行不能であれば ``True``。
        """

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
        """割り込みが発生するか完了するまで実行する。

        Args:
            payload (Any): グラフへ渡す入力ペイロード。
            thread_id (str): 実行対象のスレッドID。
            auto_resume (bool): 割り込みを自動承認するかどうか。
            interrupt_predicate (Callable[[Interrupt], bool] | None): 人手介入を許可する判定関数。
            event_consumer (Callable[[Dict[str, Any]], Awaitable[None]] | None): イベントを処理するコールバック。

        Returns:
            tuple[list[Dict[str, Any]], Optional[Interrupt], bool, Any | None]:
                収集したイベント、保留割り込み、完了フラグ、最新スナップショット。
        """

        config = self._graph_config(thread_id)
        current_payload: Any = payload
        collected_events: list[Dict[str, Any]] = []

        while True:
            pending: Interrupt | None = None
            async for event in self._graph.astream_events(
                current_payload, config=config, version=STREAM_VERSION
            ):
                sanitized = self._sanitize_event(event)
                if self._is_error_event(sanitized):
                    error_message = self._extract_error_message(sanitized)
                    sanitized.setdefault("level", "error")
                    sanitized.setdefault("message", error_message)
                    logger.error(
                        "Workflow error event detected [thread_id=%s, event=%s]: %s",
                        thread_id,
                        sanitized.get("event"),
                        error_message,
                    )
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
        """イベントストリームを生成する内部ジェネレーター。

        Args:
            payload (Any): グラフへ入力する初期ペイロード。
            thread_id (str): 実行対象のスレッドID。
            auto_resume (bool): 割り込みを自動で解消するかどうか。
            interrupt_predicate (Callable[[Interrupt], bool] | None): 割り込み許可判定関数。

        Yields:
            Any: 整形済みのイベントオブジェクト。
        """

        config = self._graph_config(thread_id)
        current_payload: Any = payload

        while True:
            pending: Interrupt | None = None
            async for event in self._graph.astream_events(
                current_payload, config=config, version=STREAM_VERSION
            ):
                sanitized = self._sanitize_event(event)
                if self._is_error_event(sanitized):
                    error_message = self._extract_error_message(sanitized)
                    sanitized.setdefault("level", "error")
                    sanitized.setdefault("message", error_message)
                    logger.error(
                        "Workflow error event detected during stream [thread_id=%s, event=%s]: %s",
                        thread_id,
                        sanitized.get("event"),
                        error_message,
                    )
                yield sanitized
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
        """イベント辞書をSSE文字列に整形する。

        Args:
            event (Dict[str, Any]): 整形対象のイベント。

        Returns:
            str: SSEフォーマットの文字列。
        """

        payload = json.dumps(event, default=self._convert_model, ensure_ascii=False)
        event_type = event.get("event", "message")
        return f"event: {event_type}\ndata: {payload}\n\n"

    def _is_error_event(self, event: Dict[str, Any]) -> bool:
        """イベントにエラーが含まれているか判定する。

        Args:
            event (Dict[str, Any]): 判定対象のイベント。

        Returns:
            bool: エラー要素を含む場合は ``True``。
        """

        event_name = str(event.get("event") or "").lower()
        if "error" in event_name:
            return True
        data = event.get("data")
        if isinstance(data, dict):
            if "error" in data:
                return True
            return any("error" in str(key).lower() for key in data.keys())
        return False

    def _extract_error_message(self, event: Dict[str, Any]) -> str:
        """イベントからエラーメッセージを抽出する。

        Args:
            event (Dict[str, Any]): 抽出対象のイベント。

        Returns:
            str: 抽出されたメッセージ。候補が無い場合は汎用メッセージ。
        """

        data = event.get("data")
        if isinstance(data, dict):
            candidate = (
                data.get("error")
                or data.get("message")
                or data.get("text")
                or data.get("details")
            )
            if candidate is not None:
                if isinstance(candidate, str):
                    return candidate
                try:
                    return json.dumps(candidate, ensure_ascii=False)
                except (TypeError, ValueError):
                    return str(candidate)
        name = event.get("event") or event.get("name")
        if name:
            return f"{name} が発生しました。"
        return "LLM処理中にエラーが発生しました。"
