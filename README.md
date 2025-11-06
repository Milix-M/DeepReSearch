# DeepReSearch

DeepReSearch は、LangGraph と LangChain を用いて多段階のウェブリサーチを編成する実験的なリサーチコパイロットです。自動計画、反復的な検索、人間によるチェックポイントを組み合わせ、構造化されたレポートを生成します。

## 特徴

- **LangGraph ワークフロー**: クエリ解析 → 調査計画生成 → ReAct ベースの検索 → 結果レポート化をステートマシンで制御。
- **Human in the loop**: LangGraph の `interrupt` を利用し、調査計画を人間がレビュー・修正した上で再開可能。
- **WebSocket API**: HITL 対応の進行を FastAPI WebSocket で配信し、クライアントから双方向操作が可能。
- **外部ツール連携**: DuckDuckGo Search (`ddgs`)、日付取得、検索結果の振り返りツールを LangChain Tools としてバインド。
- **グラフ可視化**: `graph.get_graph().draw_mermaid_png()` により、現在の LangGraph ノード構成を `graph.png` に出力。

## 必要環境

- Python 3.13 以上
- OpenRouter API キー (`OPENROUTER_API_KEY`)
- ネットワークアクセス（Web リサーチに DuckDuckGo を使用）

## セットアップ

1. 仮想環境を作成してアクティベートします。

   ```bash
   uv sync
   source .venv/bin/activate
   ```

2. OpenRouter の API キーを環境変数に設定します。`.env` を利用する場合は `python-dotenv` を活用してください。

   ```bash
   export OPENROUTER_API_KEY="your-key"
   ```

## 使い方

1. FastAPI サーバーを起動します。

   ```bash
   uvicorn src.backend.api.main:app --reload
   ```

2. 同じリポジトリ内の CLI クライアントを用いて WebSocket で接続します。

   ```bash
   python -m clients.research_client ws "人類の歴史"
   ```

3. CLI 上で中断が発生したら、`y` / `n` で判断し、必要に応じて編集済み計画 JSON を指定して再開できます。
4. 調査が完了すると、最終ステートが JSON として CLI に表示されます。Web UI は今後 `src/frontend/` 配下で実装予定です。

## リポジトリ構成

- `src/backend/agent.py` — `OSSDeepResearchAgent`。LangGraph グラフの定義とツールバインディングを管理。
- `src/backend/api/` — FastAPI エンドポイント群（ヘルスチェック、スレッド状態、WebSocket HITL インタフェース）。
- `src/backend/ai/analyze/query_analyze.py` — クエリ解析モジュールと `ResearchParameters` モデル。
- `src/backend/ai/schedule/plan_reserch.py` — 調査計画生成モジュールと関連 Pydantic モデル。
- `src/backend/ai/reflect/reflect_search_result.py` — 検索結果の振り返りロジック。
- `src/backend/ai/search/` — ReAct で利用するシステムプロンプトなど検索関連の補助コード。
- `src/backend/tools/` — DuckDuckGo Web リサーチ、日付取得、検索結果の振り返りツール実装。
- `src/frontend/` — フロントエンド実装用のプレースホルダーディレクトリ。
- `clients/` — WebSocket 経由で API と対話する CLI クライアント群。

## 開発メモ

- LangGraph の状態復元には `OPENROUTER_API_KEY` が必須です。キーが未設定の場合、LLM 呼び出しで失敗します。
- `src/backend/agent.py` の `get_compiled_graph()` は `MemorySaver` を利用しているため、Human in the loop 中断後も状態を保持します。複数セッションを並列で扱う場合は `thread_id` を明示的に管理してください。
