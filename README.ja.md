# co-harmo

> English version: [README.md](./README.md)

co-harmo は、Claude Code・Codex などの AI エージェントが DAW 上で直接音楽制作に参加できる VST3/AU プラグインです。プラグインはローカル MCP サーバー経由で現在の MIDI クリップを公開し、エージェントはトークン効率の高いテキスト表現を使って MIDI を読み取り・推論・書き換えることができます。生の MIDI バイナリや DAW 固有のスクリプトは不要です。

---

## アーキテクチャ

```
┌──────────── DAW (Logic / Cubase / Ableton / Reaper …) ────────────┐
│                                                                    │
│  ┌────────── co-harmo VST3/AU plugin (JUCE 8, C++) ─────────────┐  │
│  │                                                               │  │
│  │  AudioProcessor ── MIDI in/out (host clip ↔ buffer)          │  │
│  │                 └─ SessionState (clip, selection, tempo, sig) │  │
│  │                                                               │  │
│  │  AudioProcessorEditor                                         │  │
│  │   └─ juce::WebBrowserComponent → loads bundled index.html    │  │
│  │                                                               │  │
│  │  LocalBridgeServer (WebSocket, 127.0.0.1:random port)        │  │
│  │   ├─ exposes session state                                    │  │
│  │   └─ accepts MIDI patch ops, pending layer, undo tokens       │  │
│  └──────────────────────────┬────────────────────────────────────┘  │
└─────────────────────────────┼──────────────────────────────────────┘
                              │ ws://127.0.0.1:<port>
               ┌──────────────┴──────────────────────┐
               │  co-harmo-mcp  (Node 20+, stdio MCP) │
               │                                      │
               │  Tools:                              │
               │   get_session                        │
               │   summarize_clip                     │
               │   read_clip_as_abc                   │
               │   write_clip_from_abc                │
               │   revert_clip                        │
               └──────────────────────────────────────┘
                              ↑
                   Claude Code / Codex
```

プラグインと MCP サーバーのランデブーは `~/Library/Application Support/co-harmo/bridge.json`（macOS）または `%APPDATA%\co-harmo\bridge.json`（Windows）経由で行います。プラグイン起動時にポート番号と認証トークンをこのファイルに書き出します。

---

## クイックスタート

### 動作要件

- macOS 12+ または Windows 10/11（WebView2 ランタイム必須）
- Node 20+
- VST3 または AU 対応の DAW（Logic Pro、Reaper、Cubase、Ableton Live など）

### 1. プラグインのインストール

`co-harmo.vst3`（macOS AU の場合は `.component`）を DAW のプラグインフォルダにコピーし、プラグインを再スキャンします。

- macOS VST3: `~/Library/Audio/Plug-Ins/VST3/`
- macOS AU: `~/Library/Audio/Plug-Ins/Components/`
- Windows VST3: `C:\Program Files\Common Files\VST3\`

### 2. MCP サーバーの登録

```bash
claude mcp add co-harmo -- npx -y co-harmo-mcp
```

### 3. 接続して使う

1. DAW を開き、MIDI またはインストゥルメントトラックに co-harmo を挿入します。
2. そのトラックに MIDI クリップをロードまたは録音します。
3. プロジェクトディレクトリで Claude Code を起動します。
4. Claude にクリップの編集を依頼します。

```
現在のクリップの小節 1〜4 のメロディを和声化してください。
```

Claude は `get_session` を呼び出してクリップを ABC 記譜として読み取り、音楽的に推論したうえで修正済みクリップを書き戻します。結果は co-harmo プラグインパネルにペンディングクリップとして表示されます。パネルから DAW トラックにドラッグ＆ドロップしてコミットしてください。

詳細なエージェントワークフロー・ツールリファレンス・拡張 ABC 文法については以下を参照してください。

- [docs/agent-workflow.ja.md](docs/agent-workflow.ja.md) — セットアップ、エージェントループ、ツールリファレンス、典型的なプロンプト例、トラブルシューティング
- [docs/abc-extension.ja.md](docs/abc-extension.ja.md) — 拡張 ABC フォーマットの正式仕様

---

## ソースからビルド

```bash
# サブモジュールごとクローン（JUCE 8.x は CMake CPM で取得）
git clone --recurse-submodules https://github.com/your-org/co-harmo
cd co-harmo

# プラグイン（macOS）
cmake --preset mac-release
cmake --build --preset mac-release

# MCP サーバー
cd mcp-server
npm install
npm run build

# Web UI（プラグインの Resources に組み込まれます）
cd ../webui
npm install
npm run build
```

CI は `.github/workflows/ci.yml` により macOS・Windows 両方のビルドをプッシュごとに実行します。

---

## ステータス

| マイルストーン | 状態 |
|---|---|
| M1: 足場（JUCE プラグイン + MCP サーバー + WebUI） | 完了 |
| M2: MIDI 読み出しパス（get_session、read_clip_as_abc） | 完了 |
| M3: MIDI 書き込みパス（write_clip_from_abc、ペンディング層、ドラッグ&ドロップ） | 完了 |
| M4: エージェント体験の磨き込み（summarize_clip、ドキュメント） | 完了 |

**対応範囲:** MIDI ノートデータ（音高・ベロシティ・タイミング・CC・プログラムチェンジ）、双方向読み書き、undo トークン、ドラッグ＆ドロップによるペンディング層コミット。

**対応外（MVP）:** オーディオ生成、MPE / ポリフォニック・エクスプレッション、マルチトラック同時編集、DAW トラックへの自動挿入（DAW 固有 API が必要）、MIDI 2.0。
