# M2 手動テスト — プラグイン ↔ MCP サーバー 読み出しパス

> English version: [m2-manual-test.md](./m2-manual-test.md)

## 前提条件

- macOS、Xcode コマンドラインツール、Ninja、Node 20
- 3 つのコンポーネントをすべてビルド済み（`bash scripts/build.sh` または CMake + npm を手動実行）

## 手順

### 1. スタンドアロンプラグインを起動する

```
open build/mac-debug/plugin/co-harmo_artefacts/Debug/Standalone/co-harmo.app
```

プラグインは起動時に `~/Library/Application Support/co-harmo/bridge.json` を書き出します。
ファイルが存在し、`port`・`token`・`pid`・`sessionId` が含まれていることを確認します。

### 2. bridge.json を確認する

```
cat ~/Library/Application\ Support/co-harmo/bridge.json
```

期待されるフォーマット:
```json
{ "port": <number>, "token": "<uuid>", "pid": <number>, "sessionId": "<uuid>", "startedAt": "<iso>" }
```

### 3. プローブスクリプトを実行する

```
node scripts/m2-probe.mjs
```

期待される出力:
```
Reading bridge config from: .../bridge.json
bridge.json OK  port=...  pid=...  session=...
get_session OK: { "sessionId": "...", "sampleRate": 44100, "bpm": 120, ... }
read_clip OK: 0 events  tempo=120  ppq=480
Probe PASSED
```

MIDI がまだ録音されていない場合、`read_clip` のイベント数が 0 でも問題ありません。

### 4. MIDI クリップを録音する（オプションだが推奨）

1. プラグイン UI で MIDI 入力をアームし、数音演奏・録音します。
2. `node scripts/m2-probe.mjs` を再実行します。
3. `read_clip OK: N events`（N > 0）と表示されることを確認します。

### 5. MCP ツールを直接テストする

プラグインを起動したまま、dev モードで MCP サーバーを起動します。

```
cd mcp-server && npm run dev
```

別のターミナルまたは MCP クライアントから以下を呼び出します。

- `get_session` — セッション JSON が返ること
- `read_clip_as_abc` — ABC 記譜が返ること（ノートがない場合は空のスタッフ）

### 6. 自動スモークスクリプトを実行する

```
bash scripts/m2-smoke.sh
```

このスクリプトは全コンポーネントをビルドし、スタンドアロンアプリを起動して `bridge.json` を待ち受け、プローブを自動実行します。

## 合格基準

| チェック項目 | 期待値 |
|---|---|
| アプリ起動から 5 秒以内に `bridge.json` が生成される | Yes |
| `get_session` が `sessionId`・`bpm`・`sampleRate` を含む有効な JSON を返す | Yes |
| `read_clip` が `ClipData` オブジェクトを返す（events は空でも可） | Yes |
| `read_clip_as_abc` が `X:1` で始まる ABC 文字列を返す | Yes |
| プラグインコンソールおよび mcp-server の stderr に未キャッチ例外がない | Yes |

## 既知の制限事項

- CI の `m2-smoke` ジョブは `continue-on-error: true` を設定しています。GitHub の macOS ランナーにはディスプレイがないため、`open -a` が失敗するか、アプリがヘッドレスでオーディオエンジンを初期化できない場合があります。開発者マシン上のローカル実行が信頼できるスモークテストです。
