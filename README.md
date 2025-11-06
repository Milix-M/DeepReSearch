# DeepReSearch

DeepReSearch は、LangGraph と LangChain を用いて多段階のウェブリサーチを編成する実験的なリサーチコパイロットです。自動計画、反復的な検索、人間によるチェックポイントを組み合わせ、構造化されたレポートを生成します。現在は FastAPI + LangGraph で構成されたバックエンドに加え、Next.js 製の Web コンソールからリアルタイムに進捗を監視・操作できるようになっています。

## 主な特徴

- **LangGraph ワークフロー**: クエリ解析 → 調査計画生成 → ReAct ベースの検索 → 結果レポート化をステートマシンで制御。
- **Human in the loop**: LangGraph の `interrupt` を利用し、調査計画を人間がレビュー・修正した上で再開可能。
- **リアルタイム進捗 UI**: WebSocket 経由のイベントログを Next.js から視覚化。調査計画のレビュー・編集、再開操作、レポート閲覧をブラウザ内で完結。
- **外部ツール連携**: DuckDuckGo Search (`ddgs`)、日付取得、検索結果の振り返りツールを LangChain Tools としてバインド。
- **グラフ可視化**: `graph.get_graph().draw_mermaid_png()` により、現在の LangGraph ノード構成を `graph.png` に出力。

## 参考

- <https://zenn.dev/kikagaku/articles/c6262046cd1d6e>

## 必要環境

- Python 3.13 以上
- Node.js 18.17 以上 (Next.js 16 の動作要件)
- OpenRouter API キー (`OPENROUTER_API_KEY`)
- ネットワークアクセス（Web リサーチに DuckDuckGo を使用）

## セットアップ

### バックエンド (Python)

1. 依存関係を同期し、仮想環境をアクティベートします。

   ```bash
   uv sync
   source .venv/bin/activate
   ```

2. OpenRouter の API キーを環境変数に設定します。`.env` を利用する場合は `python-dotenv` などで読み込んでください。

   ```bash
   export OPENROUTER_API_KEY="your-key"
   ```

### フロントエンド (Next.js)

1. 依存関係をインストールします。

   ```bash
   cd src/frontend
   npm install
   ```

2. 必要に応じて `.env.local` を作成し、API / WebSocket の接続先を設定します。

   ```bash
   # NEXT_PUBLIC_API_BASE_URL=http://127.0.0.1:8000
   # NEXT_PUBLIC_WS_URL=ws://127.0.0.1:8000/ws/research
   ```

   これらの値を変更すると、ブラウザから参照するバックエンドの URL を切り替えられます。

## 使い方

### バックエンド API を起動する

```bash
uvicorn src.backend.api.main:app --reload
```

### フロントエンドコンソールを起動する

別ターミナルで Next.js の開発サーバーを立ち上げます。

```bash
cd src/frontend
npm run dev
```

ブラウザで <http://localhost:3000> を開くと DeepReSearch Console が表示され、以下をリアルタイムに確認できます。

- スレッド一覧と各ステータス
- 調査ログと進行中ステップ
- 調査計画のレビュー・編集フォーム (interrupt 発生時)
- 生成済みプランとレポートの閲覧

### CLI クライアントから操作する

```bash
python -m clients.research_client ws "人類の歴史"
```

CLI 上で中断が発生したら `y` / `n` で判断し、必要に応じて編集済み計画 JSON を指定して再開できます。

### API ドキュメント

バックエンド API のエンドポイント一覧は <http://127.0.0.1:8000/docs> から確認できます。

## Docker での起動

ローカルに Node.js や Python の実行環境を構築せずに起動する場合は Docker Compose を利用できます。

1. OpenRouter の API キーをホスト側で環境変数として設定します。

   ```bash
   export OPENROUTER_API_KEY="your-key"
   ```

2. コンテナをビルドして起動します。

   ```bash
   docker compose up --build
   ```

3. ブラウザで `http://localhost:3000` にアクセスするとフロントエンドが、`http://localhost:8000/docs` にアクセスするとバックエンド API のドキュメントが確認できます。

### 開発モードでのホットリロード

ローカルのソース更新を即時反映したい場合は、開発用オーバーライドを併用します。

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build
```

この構成ではバックエンドは `uvicorn --reload`、フロントエンドは Next.js の dev サーバーが起動し、`src/backend` や `src/frontend` 配下の変更がホットリロードされます。終了する際は `Ctrl+C` で停止してください。

## リポジトリ構成

- `src/backend/agent.py` — `OSSDeepResearchAgent`。LangGraph グラフの定義とツールバインディングを管理。
- `src/backend/api/` — FastAPI エンドポイント群（ヘルスチェック、スレッド状態、WebSocket HITL インタフェース）。
- `src/backend/ai/analyze/query_analyze.py` — クエリ解析モジュールと `ResearchParameters` モデル。
- `src/backend/ai/schedule/plan_reserch.py` — 調査計画生成モジュールと関連 Pydantic モデル。
- `src/backend/ai/reflect/reflect_search_result.py` — 検索結果の振り返りロジック。
- `src/backend/ai/search/` — ReAct で利用するシステムプロンプトなど検索関連の補助コード。
- `src/backend/tools/` — DuckDuckGo Web リサーチ、日付取得、検索結果の振り返りツール実装。
- `src/frontend/src/app/` — Next.js の画面実装。`components/` に UI コンポーネントを分割配置し、`page.tsx` がコンソールのエントリーポイント。
- `src/frontend/src/lib/` — API クライアントおよび WebSocket クライアント。
- `clients/` — WebSocket 経由で API と対話する CLI クライアント群。

## 開発メモ

- LangGraph の状態復元には `OPENROUTER_API_KEY` が必須です。キーが未設定の場合、LLM 呼び出しで失敗します。
- `src/backend/agent.py` の `get_compiled_graph()` は `MemorySaver` を利用しているため、Human in the loop 中断後も状態を保持します。複数セッションを並列で扱う場合は `thread_id` を明示的に管理してください。
- フロントエンドの DeepReSearch Console は WebSocket イベントをストリームし、調査計画のレビューや進捗がタイムライン順に並ぶよう調整されています。調査計画を更新すると、その後のメッセージがリアルタイムに追従します。
- `src/frontend/src/env.ts` に開発用のデフォルト接続先が定義されています。本番環境へデプロイする場合は `NEXT_PUBLIC_API_BASE_URL` と `NEXT_PUBLIC_WS_URL` を環境変数で上書きしてください。
