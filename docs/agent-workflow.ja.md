# co-harmo: エージェントワークフローガイド

> English version: [agent-workflow.md](./agent-workflow.md)

このドキュメントは、Claude Code および Codex が co-harmo を使って DAW での音楽制作を支援する際の正式リファレンスです。ツール呼び出しを行う前に必ずお読みください。

---

## 1. インストールとセットアップ

### プラグインのインストール

1. リリースページから co-harmo VST3/AU バンドルをダウンロードします。
2. `co-harmo.vst3`（AU の場合は `.component`）を DAW のプラグインフォルダにコピーします。
   - macOS VST3: `~/Library/Audio/Plug-Ins/VST3/`
   - macOS AU: `~/Library/Audio/Plug-Ins/Components/`
   - Windows VST3: `C:\Program Files\Common Files\VST3\`
3. DAW でプラグインを再スキャンします（Logic Pro、Reaper、Cubase、Ableton）。
4. MIDI またはインストゥルメントトラックに co-harmo を挿入します。

**動作要件:** macOS 12+ または Windows 10/11（WebView2 ランタイム必須）。MCP サーバーには Node 20+ が必要です。

### MCP サーバーの登録

**Claude Code:**
```
claude mcp add co-harmo -- npx -y co-harmo-mcp
```

**Codex (OpenAI):**
```json
{
  "mcpServers": {
    "co-harmo": {
      "command": "npx",
      "args": ["-y", "co-harmo-mcp"]
    }
  }
}
```

### プラグインの検出方法（bridge.json ランデブー）

プラグインが DAW にロードされると、ランダムポートでローカル WebSocket サーバーを起動し、ランデブーファイルを書き出します。

- macOS: `~/Library/Application Support/co-harmo/bridge.json`
- Windows: `%APPDATA%\co-harmo\bridge.json`

ファイルの内容:
```json
{ "port": 49217, "token": "a1b2c3d4..." }
```

MCP サーバーはこのファイルを起動時に読み取ってプラグインに接続します。トークンは最初の WebSocket フレーム（`hello` 認証ハンドシェイク）で必要です。ポートを上書きしたい場合は環境変数 `CO_HARMO_BRIDGE_PORT` を設定してください。

---

## 2. エージェントループ

MIDI クリップを扱う際は以下の順序で処理します。

```
DAW を開く
  └─ ターゲットトラックに co-harmo プラグインをロード
       └─ 対象の MIDI クリップを再生またはアーム
            └─ get_session を呼ぶ          ← 接続確認とクリップメタデータ取得
                 └─ summarize_clip を呼ぶ  ← クリップの小節レベル概要を取得
                      └─ 必要な小節範囲を決定
                           └─ read_clip_as_abc { rangeBars: { start, end } } を呼ぶ
                                └─ 音楽的に推論する
                                     └─ write_clip_from_abc { abc, replaceRange? } を呼ぶ
                                          └─ ユーザーに co-harmo WebUI から
                                             DAW トラックへドラッグするよう伝える
```

**重要なポイント:**

- 最初に必ず `get_session` を呼び、プラグインが接続されておりクリップがロードされている（`hasClip: true`）ことを確認します。
- 長いクリップでは `read_clip_as_abc` の前に `summarize_clip` を使い、不要なトークン消費を避けます。
- `read_clip_as_abc` には `rangeBars` を指定して、必要な小節のみ取得します。
- `write_clip_from_abc` が成功すると結果に `undoToken` が含まれます。保存しておき、必要なら `revert_clip` に渡して書き込みを取り消せます。
- 書き込み前に `diff_clip_abc { before: originalAbc, after: modifiedAbc }` を使って編集内容が意図通りであることを確認し、ユーザーに変更の概要を報告できます。
- 書き込んだクリップは *ペンディング* 層に保持されます。ユーザーが co-harmo WebUI パネルから DAW トラックにドラッグ＆ドロップしてコミットします。DAW API は使用せず、標準的な MIDI ファイルのドラッグ＆ドロップです。

---

## 3. ツールリファレンス

| ツール | 目的 | 主な入力 | 主な出力 | 使うタイミング |
|---|---|---|---|---|
| `get_session` | プラグイン接続確認とセッションメタデータ取得 | なし | `sessionId`、`bpm`、`timeSignature`、`hasClip`、`clipLengthBars` | 常に最初 |
| `summarize_clip` | 現在のクリップの小節レベルダイジェスト | なし | コンパクトな ABC サマリー、小節数、小節ごとのノート密度 | 長いクリップを読む前 |
| `read_clip_as_abc` | MIDI クリップを拡張 ABC テキストとして読み取る | `rangeBars?: { start, end }`（1 始まり、両端含む） | 拡張 ABC 文字列 | サマリー確認後、音楽を取得するとき |
| `write_clip_from_abc` | 修正した ABC をプラグインにペンディングクリップとして書き込む | `abc: string`、`replaceRange?: { startBar, endBar }`（1 始まり、両端含む） | `undoToken`、`tempMidiPath` | 音楽的推論後 |
| `revert_clip` | ペンディングクリップの書き込みを取り消す | `undoToken: string` | 確認テキスト | 結果が意図と異なるときにロールバック |
| `diff_clip_abc` | 2 つの拡張 ABC 文字列のノートレベル差分を計算する | `before: string`、`after: string` | 人間が読めるサマリー（"N notes added, M removed, velocity changed on K notes, tempo ..."）+ unified diff | 書き込み前の確認、またはユーザーへの変更説明 |

### get_session レスポンスフィールド

```jsonc
{
  "sessionId": "abc123",
  "sampleRate": 44100,
  "bpm": 120.0,
  "timeSignature": [4, 4],
  "ppq": 480,
  "hasClip": true,
  "clipLengthBars": 8
}
```

### write_clip_from_abc レスポンスフィールド

```jsonc
{
  "undoToken": "tok_...",
  "tempMidiPath": "~/.co-harmo/tmp/<sessionId>/<ts>.mid"
}
```

---

## 4. 拡張 ABC チートシート

co-harmo は標準 ABC 記譜法のスーパーセットを使用します。音価の単位は `L:1/16`（16 分音符）です。デコレーションは修飾するノートの直前に置きます。

### デコレーション構文

| デコレーション | 意味 | 範囲 / 備考 |
|---|---|---|
| `!vN!` | MIDI ベロシティ | 0–127。デフォルトの継続値は **80**。変化がなければ省略。 |
| `!t+N!` / `!t-N!` | マイクロタイミングオフセット（ティック単位、PPQ=480） | 正 = 遅れ、負 = 早め。デフォルトは **0**。変化がなければ省略。 |
| `!ccN=V!` | 後続ノートと同じティックに CC イベントを挿入 | N = コントローラー番号 0–127、V = 値 0–127 |
| `!prog=N!` | 後続ノートと同じティックにプログラムチェンジを挿入 | N = 0–127 |

### デコレーションの正規化順序

ABC を書き出す際は、常にこの順序でデコレーションを出力します。

```
!vN! !t±N! !ccN=V! ... !prog=N!
```

これにより、モデルがクリップを編集したときに無意味な差分が発生しません。

### 継続デフォルト（変化なしの省略ルール）

エンコーダーは継続値を追跡し、変化があった場合のみデコレーションを出力します。

- 初期ベロシティ: **80**
- 初期マイクロタイミング: **0**（オフセットなし）

全ノートのベロシティが 80 でオフセットが 0 のクリップは、デコレーションなしのピッチと音価だけで表現されます。

### ABC 構造の例

```abc
X:1
T:co-harmo clip
M:4/4
L:1/16
Q:1/4=120
K:C
!v90!C4 E4 G4 c4 | !v70!e4 g4 c'4 z4 | ...
```

### 休符

`z` に続けて省略可能な 16 分音符単位の音価を指定します。例: `z4` = 4 分音符休符、`z` = 16 分音符休符。

### 和音

`[...]` 内に同時発音ノートを並べます。例: `[CEG]4` = C メジャー 4 分音符和音。

### 音高表記

標準 ABC のオクターブ規則を使用します（`C` = ミドル C、`c` = 1 オクターブ上、`c'` = 2 オクターブ上、`C,` = ミドル C の 1 オクターブ下）。臨時記号: `^` = シャープ、`_` = フラット。音価倍率は 16 分音符単位（`C` = 1/16、`C4` = 1/4、`C8` = 1/2、`C16` = 全音符）。

---

## 5. 典型的なユーザープロンプト

ユーザーが依頼しそうな内容と、それに対応するツール呼び出し順序の例です。

**「このメロディを和声化して」**
1. `get_session` → クリップのロード確認
2. `summarize_clip` → 長さの確認
3. `read_clip_as_abc` → メロディを読み取る
4. 推論: 各メロディノートの下にコードトーンを追加
5. 和声化した ABC で `write_clip_from_abc`
6. ユーザーにプラグイン UI からペンディングクリップをドラッグするよう伝える

**「1/8 スウィング 55% でクォンタイズして」**
1. `get_session`
2. `read_clip_as_abc`
3. ティック位置を再計算: 拍頭はそのまま、裏拍を各拍の 55% の位置にシフト（`!t±N!` デコレーションを調整）
4. `write_clip_from_abc`

**「小節 5〜8 にカウンターメロディを追加して」**
1. `get_session`
2. `read_clip_as_abc { rangeBars: { start: 5, end: 8 } }` — 対象範囲のみ取得
3. 互換性のある調性・リズムでカウンターメロディを作成
4. `write_clip_from_abc { replaceRange: { startBar: 5, endBar: 8 } }`

**「完全 5 度上にトランスポーズして」**
1. `get_session`
2. `read_clip_as_abc`
3. 全ピッチに 7 半音を加算（ノートの文字と臨時記号を更新）
4. `write_clip_from_abc`

**「小節 3〜4 のノート密度を減らして」**
1. `get_session`
2. `read_clip_as_abc { rangeBars: { start: 3, end: 4 } }`
3. 弱拍のオフビートノートを削除して密度を低下
4. `write_clip_from_abc { replaceRange: { startBar: 3, endBar: 4 } }`

---

## 6. トラブルシューティング

### プラグインが検出されない / "bridge.json not found"

- プラグインが DAW にロードされており、トラックがアクティブ（バイパスされていない）であることを確認します。
- ランデブーファイルの存在を確認します。
  - macOS: `~/Library/Application Support/co-harmo/bridge.json`
  - Windows: `%APPDATA%\co-harmo\bridge.json`
- ファイルがない場合は、トラックからプラグインを削除して再挿入し、ブリッジサーバーを強制再起動します。
- ファイアウォールやセキュリティソフトが `bridge.json` に記載のポートで `127.0.0.1` をブロックしていないか確認します。

### トークン不一致 / "Auth failed"

- `bridge.json` 内のトークンはプラグインを再起動するたびに再生成されます。プラグインをリロードしたら MCP サーバーも再起動してください。
  ```
  claude mcp restart co-harmo
  ```
- `CO_HARMO_BRIDGE_PORT` 環境変数で上書きしている場合は、ポートが `bridge.json` の値と一致しているか確認します。

### 書き込み時の ABC パースエラー

- エラーメッセージには行番号と列番号が含まれます: `ABC parse error at line N, col M: <reason>`。
- 指定された位置の ABC 文字列を修正します。よくある原因:
  - デコレーション `!` が閉じていない — すべての `!` には対応する閉じ `!` が必要です。
  - 音価が `0` — 最小音価は `1`（16 分音符 1 つ分）です。
  - ピッチが MIDI 範囲外 — 有効な MIDI ピッチは 0–127 です（C-1〜G9 相当）。
  - `L:` フィールドが `L:1/16` でない — コーデックは 16 分音符単位のみ対応しています。

### ドラッグ＆ドロップが動作しない

- ペンディングクリップのドラッグは DAW 内の co-harmo WebUI パネルから開始します。ペンディングクリップ横のドラッグハンドルをクリックし、MIDI トラックの空きエリアにドロップします。
- macOS では、ドラッグソースがブロックされている場合、「システム設定」→「プライバシーとセキュリティ」で DAW に「アクセシビリティ」権限を付与します。
- Windows では、プロセス間のドラッグ＆ドロップが壊れるため、DAW を管理者として実行していないことを確認します。

### MIDI 書き込み中のオーディオグリッチ

- 書き込み操作は非破壊的です。元のクリップは accept または revert されるまでスナップショットとして保持されます。グリッチが発生した場合は、`undoToken` を `revert_clip` に渡してすぐに前の状態に戻せます。
- DAW トランスポートが録音中の状態で `write_clip_from_abc` を呼ぶことは避けてください。
