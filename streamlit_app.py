import asyncio
import json
import uuid
from typing import Any, Dict, List, Optional

import streamlit as st
from langchain_core.messages import BaseMessage
from langgraph.types import Command, Interrupt
from pydantic import ValidationError

from agent import OSSDeepResearchAgent
from src.ai.reflect.reflect_search_result import ReflectionResultSchema
from src.ai.schedule.plan_reserch import GeneratedObjectSchema

st.set_page_config(page_title="OSS Deep Research", layout="wide")

_EVENT_PREVIEW_LIMIT = 500
_STREAM_VERSION = "v1"


def _inject_custom_css() -> None:
    st.markdown(
        """
        <style>
        .status-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
            gap: 0.75rem;
            margin-top: 0.75rem;
        }
        .status-card {
            border-radius: 12px;
            padding: 0.9rem 1rem;
            background: rgba(42, 63, 120, 0.08);
            border: 1px solid rgba(120, 144, 255, 0.12);
        }
        .status-card h4 {
            font-size: 0.95rem;
            margin-bottom: 0.35rem;
        }
        .status-card p {
            font-size: 0.8rem;
            margin: 0;
            opacity: 0.7;
        }
        .step-timeline {
            margin: 1.2rem 0 0.8rem;
        }
        .step-item {
            display: flex;
            align-items: center;
            gap: 0.75rem;
            padding: 0.65rem 0.85rem;
            border-radius: 10px;
            border: 1px solid rgba(120, 144, 255, 0.1);
            background: rgba(255, 255, 255, 0.04);
            margin-bottom: 0.5rem;
        }
        .step-item .step-icon {
            font-size: 1.2rem;
        }
        .step-item.done {
            border-color: rgba(76, 175, 80, 0.45);
            background: rgba(76, 175, 80, 0.08);
        }
        .step-item.active {
            border-color: rgba(33, 150, 243, 0.45);
            background: rgba(33, 150, 243, 0.1);
        }
        .step-text {
            display: flex;
            flex-direction: column;
        }
        .step-text span:first-child {
            font-weight: 600;
            font-size: 0.95rem;
        }
        .step-text span:last-child {
            font-size: 0.78rem;
            opacity: 0.75;
        }
        .plan-card {
            border-radius: 12px;
            border: 1px solid rgba(120, 144, 255, 0.12);
            padding: 0.85rem 1rem;
            margin-bottom: 0.7rem;
            background: rgba(255, 255, 255, 0.02);
        }
        .plan-card h5 {
            margin: 0 0 0.4rem 0;
            font-size: 0.95rem;
        }
        .plan-card ul {
            margin: 0.25rem 0 0 1rem;
            padding: 0;
            font-size: 0.8rem;
        }
        .report-container {
            border-radius: 14px;
            padding: 1.2rem 1.4rem;
            border: 1px solid rgba(120, 144, 255, 0.18);
            background: rgba(18, 25, 36, 0.35);
            min-height: 420px;
        }
        .report-container h2, .report-container h3, .report-container h4 {
            margin-top: 1rem;
        }
        .report-placeholder {
            border-radius: 12px;
            padding: 1rem 1.2rem;
            border: 1px dashed rgba(120, 144, 255, 0.35);
            text-align: center;
            margin-top: 1rem;
        }
        .interrupt-banner {
            border-radius: 10px;
            padding: 0.9rem 1rem;
            background: rgba(255, 193, 7, 0.15);
            border: 1px solid rgba(255, 193, 7, 0.45);
            margin-bottom: 0.75rem;
            box-shadow: 0 4px 12px rgba(255, 193, 7, 0.18);
        }
        .interrupt-banner strong {
            display: block;
            margin-bottom: 0.3rem;
        }
        </style>
        """,
        unsafe_allow_html=True,
    )
def _ensure_agent() -> None:
    """Initialize agent and runtime scaffolding in the Streamlit session."""
    if "graph" in st.session_state:
        return

    agent = OSSDeepResearchAgent()
    st.session_state.agent = agent
    st.session_state.graph = agent.get_compiled_graph()
    _reset_runtime_state(new_thread=True)


def _reset_runtime_state(*, new_thread: bool, query: str | None = None) -> None:
    st.session_state.event_log = []
    st.session_state.state_snapshot = None
    _set_pending_interrupt(None)
    st.session_state.workflow_complete = False
    st.session_state.last_error = None
    st.session_state.current_query = query or ""
    st.session_state.current_plan_json = None
    if "plan_editor_text" in st.session_state:
        del st.session_state["plan_editor_text"]
    if new_thread:
        st.session_state.graph_thread_config = {
            "configurable": {
                "thread_id": str(uuid.uuid4()),
            }
        }


def _set_pending_interrupt(interrupt: Optional[Interrupt]) -> None:
    st.session_state.pending_interrupt = interrupt
    st.session_state.show_interrupt_dialog = bool(interrupt)


def _shorten(obj: Any, limit: int = _EVENT_PREVIEW_LIMIT) -> str:
    text = repr(obj)
    if len(text) <= limit:
        return text
    return f"{text[: limit - 3]}..."


def _record_event(event: Dict[str, Any]) -> None:
    event_type = event.get("event", "")
    name = event.get("name", "")
    data = event.get("data") or {}

    if event_type == "on_chain_stream":
        preview = _shorten(data.get("chunk")) if isinstance(data, dict) else ""
    elif event_type == "on_chain_end":
        preview = _shorten(data.get("output")) if isinstance(data, dict) else ""
    else:
        preview = ""

    label = f"[{event_type}] {name}".strip()
    if preview:
        label = f"{label}: {preview}"
    st.session_state.event_log.append(label)


def _extract_interrupt(event: Dict[str, Any]) -> Optional[Interrupt]:
    data = event.get("data")
    if not isinstance(data, dict):
        return None

    payload = None
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


def _graph_config() -> Dict[str, Any]:
    return st.session_state.graph_thread_config


def _graph() -> Any:
    return st.session_state.graph


async def _run_until_pause(payload: Any) -> None:
    graph = _graph()
    config = _graph_config()

    pending: Optional[Interrupt] = None
    try:
        async for event in graph.astream_events(payload, config=config, version=_STREAM_VERSION):
            _record_event(event)
            interrupt = _extract_interrupt(event)
            if interrupt:
                pending = interrupt
    except Exception as exc:  # pragma: no cover - surfaced via UI
        st.session_state.last_error = str(exc)
        raise
    finally:
        _set_pending_interrupt(pending)
        try:
            st.session_state.state_snapshot = graph.get_state(config)
        except Exception:
            st.session_state.state_snapshot = None
        st.session_state.workflow_complete = pending is None and _is_run_finished()


def _is_run_finished() -> bool:
    snapshot = st.session_state.get("state_snapshot")
    if snapshot is None:
        return False
    return not getattr(snapshot, "next", ())


def _convert_model(obj: Any) -> Any:
    if hasattr(obj, "model_dump"):
        return obj.model_dump()
    if isinstance(obj, dict):
        return {k: _convert_model(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_convert_model(v) for v in obj]
    return obj


def _messages_as_dict(messages: List[BaseMessage]) -> List[Dict[str, Any]]:
    items: List[Dict[str, Any]] = []
    for message in messages:
        entry: Dict[str, Any] = {
            "role": getattr(message, "type", message.__class__.__name__),
            "content": getattr(message, "content", ""),
        }
        tool_calls = getattr(message, "tool_calls", None)
        if tool_calls:
            entry["tool_calls"] = [str(call) for call in tool_calls]
        additional = getattr(message, "additional_kwargs", None)
        if additional:
            entry["additional_kwargs"] = additional
        items.append(entry)
    return items


def _state_values() -> Dict[str, Any]:
    snapshot = st.session_state.get("state_snapshot")
    if snapshot is None:
        return {}
    values = getattr(snapshot, "values", {})
    return dict(values)


def _progress_info() -> tuple[float, str]:
    values = _state_values()
    stage = 0
    label = "入力待ち"

    if st.session_state.get("current_query"):
        label = "準備完了"

    if values.get("user_input"):
        stage = 1
        label = "ユーザー入力を取得"

    if values.get("research_parameters"):
        stage = 2
        label = "クエリ解析中"

    plan = values.get("research_plan")
    if plan:
        stage = 3
        label = "リサーチ計画を生成"

    if values.get("messages"):
        stage = 4
        label = "ディープリサーチ実行中"

    if values.get("report"):
        stage = 5
        label = "レポートを生成"
    elif st.session_state.get("workflow_complete"):
        stage = 5
        label = "ワークフロー完了"

    total_stages = 5
    progress_value = min(stage / total_stages, 1.0)
    return progress_value, label


def _render_progress() -> None:
    progress_value, label = _progress_info()
    st.progress(progress_value, text=label)


def _step_statuses(values: Dict[str, Any]) -> List[Dict[str, str]]:
    params = values.get("research_parameters")
    plan = values.get("research_plan")
    analysis = values.get("analysys")
    report = values.get("report")

    steps = [
        {
            "label": "クエリ解析",
            "description": "検索クエリの深掘りとパラメーター抽出",
            "completed": bool(params),
            "ready": bool(values.get("user_input")),
        },
        {
            "label": "リサーチ計画",
            "description": "セクション構成と調査軸の策定",
            "completed": bool(plan),
            "ready": bool(params),
        },
        {
            "label": "検索・振り返り",
            "description": "ウェブ検索と結果の反映",
            "completed": bool(analysis),
            "ready": bool(plan) or bool(values.get("messages")),
        },
        {
            "label": "レポート生成",
            "description": "最終レポートをまとめて出力",
            "completed": bool(report),
            "ready": bool(analysis) or bool(values.get("messages")),
        },
    ]

    active_assigned = False
    results: List[Dict[str, str]] = []
    for step in steps:
        if step["completed"]:
            status = "done"
        elif not active_assigned and step.get("ready"):
            status = "active"
            active_assigned = True
        elif not active_assigned and not results:
            status = "active"
            active_assigned = True
        else:
            status = "pending"
        results.append(
            {
                "label": step["label"],
                "description": step["description"],
                "status": status,
            }
        )
    return results


def _render_step_timeline(values: Dict[str, Any]) -> None:
    steps = _step_statuses(values)
    html_parts = ["<div class='step-timeline'>"]
    icon_map = {
        "done": "✅",
        "active": "⏳",
        "pending": "⬜",
    }
    for step in steps:
        css_class = f"step-item {step['status']}"
        icon = icon_map.get(step["status"], "⬜")
        html_parts.append(
            f"<div class='{css_class}'><span class='step-icon'>{icon}</span>"
            f"<div class='step-text'><span>{step['label']}</span><span>{step['description']}</span></div></div>"
        )
    html_parts.append("</div>")
    st.markdown("".join(html_parts), unsafe_allow_html=True)


def _render_plan_overview(plan: GeneratedObjectSchema) -> None:
    research_plan = plan.research_plan
    st.markdown("### 調査概要")
    if research_plan.purpose:
        st.markdown(f"**目的**: {research_plan.purpose}")
    if research_plan.structure:
        if research_plan.structure.introduction:
            st.markdown(
                f"- **イントロダクション**: {research_plan.structure.introduction}"
            )
        if research_plan.structure.conclusion:
            st.markdown(
                f"- **結論**: {research_plan.structure.conclusion}"
            )


def _render_plan_sections(plan: GeneratedObjectSchema) -> None:
    research_plan = plan.research_plan
    st.markdown("### セクション構成")
    for section in research_plan.sections:
        questions = "".join(f"<li>{q}</li>" for q in section.key_questions)
        st.markdown(
            f"<div class='plan-card'><h5>{section.title}</h5><p>{section.focus}</p><ul>{questions}</ul></div>",
            unsafe_allow_html=True,
        )

    if plan.meta_analysis:
        with st.expander("メタ分析メモ", expanded=False):
            st.write(plan.meta_analysis)


def _analysis_object(analysis: Any) -> Optional[Any]:
    if analysis is None:
        return None
    if isinstance(analysis, ReflectionResultSchema):
        return analysis
    if isinstance(analysis, dict):
        try:
            return ReflectionResultSchema.model_validate(analysis)
        except ValidationError:
            return None
    return None


def _render_analysis_summary(analysis: Any) -> None:
    analysis_obj = _analysis_object(analysis)
    if not analysis_obj:
        return

    st.markdown("#### 検索結果の振り返り")
    with st.expander("重要な洞察・改善点", expanded=False):
        if analysis_obj.key_insights:
            st.markdown("**重要な洞察**")
            for item in analysis_obj.key_insights:
                st.markdown(f"- {item.insight} (信頼度: {item.confidence}/10)")
        if analysis_obj.information_gaps:
            st.markdown("\n**情報ギャップ**")
            for gap in analysis_obj.information_gaps:
                st.markdown(f"- {gap}")
        if analysis_obj.contradictions:
            st.markdown("\n**矛盾点**")
            for contradiction in analysis_obj.contradictions:
                st.markdown(f"- {contradiction}")
        if analysis_obj.improved_queries:
            st.markdown("\n**改善クエリ案**")
            for query in analysis_obj.improved_queries:
                st.markdown(f"- {query.query}: {query.rationale}")
        if analysis_obj.summary:
            st.markdown("\n**サマリー**")
            st.write(analysis_obj.summary)


def _render_left_column(values: Dict[str, Any]) -> None:
    plan = _current_plan_obj()
    pending_interrupt = st.session_state.get("pending_interrupt")

    if pending_interrupt:
        st.markdown(
            "<div class='interrupt-banner'><strong>人間による確認が必要です</strong>指示に応じて続行してください。</div>",
            unsafe_allow_html=True,
        )
        _render_interrupt_controls()
    elif st.session_state.workflow_complete and values.get("report"):
        st.success("最終レポートが完成しました。")

    if plan:
        _render_plan_overview(plan)

    st.markdown("### ワークフローの状況")
    _render_step_timeline(values)

    if plan:
        _render_plan_sections(plan)

    analysis = values.get("analysys")
    if analysis:
        _render_analysis_summary(analysis)

    messages = values.get("messages")
    if messages:
        with st.expander("ReAct メッセージ履歴", expanded=False):
            st.json(_messages_as_dict(messages))


def _render_report_panel(values: Dict[str, Any]) -> None:
    st.markdown("### 最終レポート")
    report = values.get("report")
    if report:
        with st.container():
            st.markdown('<div class="report-container">', unsafe_allow_html=True)
            st.markdown(report)
            st.markdown('</div>', unsafe_allow_html=True)
    else:
        st.caption("レポート生成中です。完了するとここに表示されます。")


def _current_plan_obj() -> Optional[GeneratedObjectSchema]:
    values = _state_values()
    plan = values.get("research_plan")
    if isinstance(plan, GeneratedObjectSchema):
        return plan
    if isinstance(plan, dict):
        try:
            return GeneratedObjectSchema.model_validate(plan)
        except ValidationError:
            return None
    return None


def _plan_json(plan: GeneratedObjectSchema) -> str:
    return plan.model_dump_json(indent=2, ensure_ascii=False)


def _update_plan_buffer() -> None:
    plan = _current_plan_obj()
    if not plan:
        return
    plan_json = _plan_json(plan)
    if st.session_state.get("current_plan_json") == plan_json:
        return
    st.session_state.current_plan_json = plan_json
    st.session_state["plan_editor_text"] = plan_json


def _parse_plan(text: str) -> GeneratedObjectSchema:
    data = json.loads(text)
    return GeneratedObjectSchema.model_validate(data)


def _run_graph(payload: Any, *, spinner_text: str | None = "処理を実行中です...") -> None:
    if "event_log" not in st.session_state:
        st.session_state.event_log = []
    st.session_state.event_log.append(f"呼び出し: {_shorten(payload)}")
    try:
        if spinner_text:
            with st.spinner(spinner_text):
                asyncio.run(_run_until_pause(payload))
        else:
            asyncio.run(_run_until_pause(payload))
    except Exception:
        # error message already stored
        return


def _resume_graph(resume_value: Any, plan_override: GeneratedObjectSchema | None = None) -> None:
    interrupt = st.session_state.get("pending_interrupt")
    _set_pending_interrupt(None)
    if "event_log" not in st.session_state:
        st.session_state.event_log = []
    st.session_state.event_log.append("人間による確認応答を処理中")
    resume_payload: Any
    if interrupt and isinstance(resume_value, str):
        resume_payload = {interrupt.id: resume_value}
    else:
        resume_payload = resume_value

    command_kwargs: Dict[str, Any] = {"resume": resume_payload}
    if plan_override is not None:
        command_kwargs["update"] = {"research_plan": plan_override}

    _run_graph(Command(**command_kwargs), spinner_text="次のステップへ進行中です...")

    if st.session_state.get("last_error") and not st.session_state.get("pending_interrupt"):
        _set_pending_interrupt(interrupt if isinstance(interrupt, Interrupt) else None)


def _render_interrupt_controls() -> None:
    interrupt = st.session_state.get("pending_interrupt")
    if not interrupt:
        return
    if not st.session_state.get("show_interrupt_dialog", False):
        return

    st.warning(interrupt.value)
    _update_plan_buffer()

    cols = st.columns(2)
    with cols[0]:
        if st.button("編集せずに続行する (n)", use_container_width=True):
            _resume_graph("n")
            st.rerun()

    with cols[1]:
        with st.form("plan_edit_form"):
            st.markdown("必要に応じて計画内容を修正してから続行できます。")
            default_text = st.session_state.get("plan_editor_text") or ""
            plan_text = st.text_area(
                "GeneratedObjectSchema JSON (編集可)",
                value=default_text,
                key="plan_editor_text",
                height=320,
            )
            submitted = st.form_submit_button("修正を保存して続行する (y)")
            if submitted:
                plan_override = None
                if plan_text.strip():
                    try:
                        plan_override = _parse_plan(plan_text)
                    except (json.JSONDecodeError, ValidationError) as exc:
                        st.error(f"計画の JSON が正しくありません: {exc}")
                        return
                _resume_graph("y", plan_override=plan_override)
                st.rerun()


def _render_event_log() -> None:
    if not st.session_state.event_log:
        return
    with st.expander("実行イベント", expanded=False):
        for line in st.session_state.event_log:
            st.code(line, language="text")


def main() -> None:
    _ensure_agent()
    _inject_custom_css()

    st.title("OSS Deep Research")
    st.caption("[LangGraph+HITL+ReAct] + Streamlit によるディープリサーチプラットフォーム")

    with st.form("query_form"):
        query = st.text_area(
            "リサーチしたいテーマ",
            value=st.session_state.get("current_query", ""),
            height=160,
            placeholder="例: 日本の再生可能エネルギー政策の最新動向",
        )
        submitted = st.form_submit_button("ディープリサーチを開始")
        if submitted:
            query_text = (query or "").strip()
            if not query_text:
                st.warning("リサーチ内容を入力してください。")
            else:
                _reset_runtime_state(new_thread=True, query=query_text)
                _run_graph({"user_input": query_text}, spinner_text="ディープリサーチを開始しています...")

    _render_progress()

    if st.session_state.last_error:
        st.error(st.session_state.last_error)

    values = _state_values()
    left_col, right_col = st.columns([0.42, 0.58], gap="large")
    with left_col:
        _render_left_column(values)
    with right_col:
        _render_report_panel(values)

    _render_event_log()


if __name__ == "__main__":
    main()
