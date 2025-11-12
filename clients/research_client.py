"""Deep Research API と対話するための簡易クライアント。"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
from typing import Any, Dict
from urllib.parse import urlparse, urlunparse

try:
    import websockets
except ImportError:  # pragma: no cover - optional dependency
    websockets = None


async def _ainput(prompt: str) -> str:
    """非同期に標準入力から文字列を取得する。"""

    return await asyncio.to_thread(input, prompt)


def _print_event(prefix: str, payload: Dict[str, Any]) -> None:
    """イベント情報を整形して出力する。"""

    print(f"[{prefix}] {json.dumps(payload, ensure_ascii=False)}")


_DEFAULT_BASE_URL = os.environ.get("DEEPRESEARCH_API_BASE", "http://127.0.0.1:8000")


async def _websocket_research(args: argparse.Namespace) -> None:
    """WebSocket 経由でHITL付きリサーチを実行する。"""

    if websockets is None:
        print(
            "websockets パッケージが必要です。`pip install websockets` を実行してください。"
        )
        return

    parsed = urlparse(args.base_url)
    scheme = "wss" if parsed.scheme == "https" else "ws"
    path = parsed.path.rstrip("/")
    ws_url = urlunparse((scheme, parsed.netloc, f"{path}/ws/research", "", "", ""))

    async with websockets.connect(ws_url) as ws:  # type: ignore[union-attr]
        await ws.send(json.dumps({"query": args.query}, ensure_ascii=False))

        async for raw in ws:
            try:
                message = json.loads(raw)
            except json.JSONDecodeError:
                print(f"[invalid] {raw}")
                continue

            msg_type = message.get("type")

            if msg_type == "thread_started":
                print(f"Thread started: {message.get('thread_id')}")
            elif msg_type == "event":
                _print_event("event", message.get("payload", {}))
            elif msg_type == "interrupt":
                interrupt = message.get("interrupt", {})
                _print_event("interrupt", interrupt)

                while True:
                    decision = (await _ainput("[y/n] > ")).strip().lower()
                    if decision in {"y", "n"}:
                        break
                    print("'y' か 'n' を入力してください。")

                plan_payload = None
                if decision == "y":
                    plan_path = (
                        await _ainput("計画JSONのパス（未入力でスキップ）> ")
                    ).strip()
                    if plan_path:
                        try:
                            with open(plan_path, "r", encoding="utf-8") as handle:
                                plan_payload = json.load(handle)
                        except OSError as exc:
                            print(f"計画ファイルを開けませんでした: {exc}")
                            plan_payload = None
                        except json.JSONDecodeError as exc:
                            print(f"計画JSONの解析に失敗しました: {exc}")
                            plan_payload = None

                await ws.send(
                    json.dumps(
                        {"decision": decision, "plan": plan_payload}, ensure_ascii=False
                    )
                )
            elif msg_type == "complete":
                print("Workflow completed. State:")
                print(
                    json.dumps(message.get("state", {}), ensure_ascii=False, indent=2)
                )
                return
            elif msg_type == "error":
                print(f"[error] {message.get('message')}")
                return
            else:
                print(f"[unknown] {message}")


async def _dispatch(args: argparse.Namespace) -> None:
    """サブコマンドに応じて WebSocket 実行をディスパッチする。"""

    if args.command == "ws":
        await _websocket_research(args)
    else:  # pragma: no cover - argparse が保証する
        raise ValueError(f"unknown command: {args.command}")


def _build_parser() -> argparse.ArgumentParser:
    """コマンドライン引数パーサーを構築する。"""

    parser = argparse.ArgumentParser(description="Deep Research API クライアント")
    parser.add_argument(
        "--base-url",
        default=_DEFAULT_BASE_URL,
        help="API のベース URL (既定: %(default)s)",
    )

    subparsers = parser.add_subparsers(dest="command", required=True)

    ws_parser = subparsers.add_parser("ws", help="WebSocket でHITL操作を行う")
    ws_parser.add_argument("query", help="リサーチしたいテーマや質問文")

    return parser


def main(argv: list[str] | None = None) -> int:
    """エントリーポイント。"""

    parser = _build_parser()
    args = parser.parse_args(argv)

    try:
        asyncio.run(_dispatch(args))
    except Exception as exc:  # pragma: no cover - CLI 実行時の予期しない例外
        print(f"エラーが発生しました: {exc}")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
