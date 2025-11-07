# DeepReSearch

DeepReSearch は、LangGraph・LangChain・Streamlit を組み合わせて多段階のウェブリサーチを編成する実験的なリサーチコパイロットです。自動計画、反復的な検索、人間によるチェックポイントを組み合わせ、構造化されたレポートを生成します。

## 特徴

- **LangGraph ワークフロー**: クエリ解析 → 調査計画生成 → ReAct ベースの検索 → 結果レポート化をステートマシンで制御。
- **Human in the loop**: LangGraph の `interrupt` を利用し、調査計画を人間がレビュー・修正した上で再開可能。
- **Streamlit UI**: 進捗バー、タイムライン、調査概要、最終レポートを 2 カラムで可視化。
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

1. Streamlit アプリを起動します。

   ```bash
   streamlit run streamlit_app.py
   ```

2. 「リサーチしたいテーマ」に調査クエリを入力し、ディープリサーチを開始します。
3. LangGraph がクエリ解析と調査計画を自動生成します。Human in the loop のプロンプトが表示されたら、`y` で続行、`n` でスキップ、必要に応じて JSON 形式の調査計画を編集して再開できます。
4. リサーチが完了すると、最終レポートが右カラムに表示されます。イベントログで LangGraph のストリームを確認できます。

## リポジトリ構成

- `streamlit_app.py` — Streamlit UI。進捗タイムライン、調査概要、ヒューマンレビュー、レポート表示を実装。
- `agent.py` — `OSSDeepResearchAgent`。LangGraph グラフの定義とツールバインディングを管理。
- `src/ai/analyze/query_analyze.py` — クエリ解析モジュールと `ResearchParameters` モデル。
- `src/ai/schedule/plan_reserch.py` — 調査計画生成モジュールと関連 Pydantic モデル。
- `src/ai/reflect/reflect_search_result.py` — 検索結果の振り返りロジック。
- `src/ai/search/` — ReAct で利用するシステムプロンプトなど検索関連の補助コード。
- `src/tools/` — DuckDuckGo Web リサーチ、日付取得、検索結果の振り返りツール実装。
- `graph.png` — 最新の LangGraph ノード構成の可視化サンプル。

## 開発メモ

- テストスイートは未整備のため、機能追加時は手動で Streamlit アプリを確認してください。
- LangGraph の状態復元には `OPENROUTER_API_KEY` が必須です。キーが未設定の場合、LLM 呼び出しで失敗します。
- `agent.py` の `get_compiled_graph()` は `MemorySaver` を利用しているため、Human in the loop 中断後も状態を保持します。複数セッションを並列で扱う場合は `thread_id` を明示的に管理してください。
