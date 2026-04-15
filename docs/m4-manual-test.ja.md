# M4 手動テスト — 実 DAW での summarize_clip + diff_clip_abc

> English version: [m4-manual-test.md](./m4-manual-test.md)

## 前提条件

- Logic Pro / Reaper / Cubase / Ableton Live がインストールされた macOS または Windows
- co-harmo VST3 をビルド・インストール済み（`docs/agent-workflow.md` §1 参照）
- MCP サーバー登録済み: `claude mcp add co-harmo -- npx -y co-harmo-mcp`
- Node 20+、mcp-server ビルド済み（`mcp-server/` 内で `npm run build` 実行済み）

## セットアップ

1. DAW を開き、120 BPM・4/4 拍子の新規プロジェクトを作成します。
2. MIDI インストゥルメントトラックに **co-harmo** を挿入します。
3. 8 小節以上の MIDI クリップを描画またはインポートします。4 小節にわたって C メジャースケールを繰り返したものが動作確認に適しています。
4. `~/Library/Application Support/co-harmo/bridge.json`（macOS）または `%APPDATA%\co-harmo\bridge.json`（Windows）が存在し、有効な `port` と `token` を含んでいることを確認します。

## テストケース

### TC-1: summarize_clip — 基本ダイジェスト

**手順:**
1. Claude Code から `get_session` を呼び出し、`hasClip: true` かつ `clipLengthBars >= 4` であることを確認します。
2. `summarize_clip`（引数なし）を呼び出します。

**期待結果:**
- `totalBars`・`bpm`・`timeSignature`・`trackHint`・`barDigest` を含む JSON が返ります。
- `barDigest` には小節ごとに 1 エントリがあり、各エントリに `noteCount`・`pitchRange [lo, hi]`・`avgVel`・`density` が含まれます。
- `trackHint` は `"melody"`・`"chord/poly"`・`"lead/high"`・`"bass"`・`"empty"` のいずれかです。
- 32 小節クリップでの総レスポンスサイズは 2 KB 未満です。

**合格基準:** エラーなし。`totalBars` が描画したクリップと一致すること。ノートがある小節の `noteCount > 0` であること。

---

### TC-2: summarize_clip — maxBars パラメーター

**手順:**
1. `summarize_clip { maxBars: 2 }` を呼び出します。

**期待結果:**
- `barDigest` にエントリが 2 件（小節 1 と小節 2）だけ含まれます。
- `totalBars` は引き続きクリップの全体長を反映します。

**合格基準:** `barDigest.length === 2` であること。

---

### TC-3: diff_clip_abc — 変更なしのベースライン

**手順:**
1. `read_clip_as_abc` を呼び出して ABC 文字列を取得します（`abc` とします）。
2. `diff_clip_abc { before: abc, after: abc }` を呼び出します。

**期待結果:**
- `summary` が `"no changes"` です。
- `unifiedDiff` に `"(no textual changes)"` が含まれます。

**合格基準:** 変更件数がゼロであること。

---

### TC-4: diff_clip_abc — ベロシティ編集

**手順:**
1. TC-3 で取得した ABC 文字列を使います。
2. `after` のコピーで、小節 1 の最初のノートの直前に `!v100!` を手動で追加します。
3. `diff_clip_abc { before: <original>, after: <modified> }` を呼び出します。

**期待結果:**
- `summary` に `"velocity changed on N notes"` が含まれます。
- `unifiedDiff` に元の小節を示す `−` 行と修正済み小節を示す `+` 行が表示されます。

**合格基準:** `velChanged` エントリが 1 件以上あること。diff に修正済み小節が表示されること。

---

### TC-5: diff_clip_abc — ノート追加

**手順:**
1. 元の ABC を使います。`after` のコピーで、小節 2 の休符 `z4` をノート（例: `G4`）に置き換えます。
2. `diff_clip_abc { before: <original>, after: <modified> }` を呼び出します。

**期待結果:**
- `summary` に `"1 note added"` が含まれます。

**合格基準:** `"added"` のカウントが 1 以上であること。

---

### TC-6: M4 ツールを使った完全なエージェントループ

**手順:**
1. `get_session` → `clipLengthBars` を確認します。
2. `summarize_clip` → ノートが少ない小節（`noteCount` が低い）を特定します。
3. `read_clip_as_abc { rangeBars: { start: <sparse bar>, end: <sparse bar> } }` を呼び出します。
4. その小節にパッシングノートを追加します。
5. `diff_clip_abc { before: <original>, after: <modified> }` → 追加が 1 件であることを確認します。
6. `write_clip_from_abc { abc: <modified>, replaceRange: { startBar: <n>, endBar: <n> } }` を呼び出します。
7. co-harmo WebUI でペンディングクリップが表示されることを確認します。
8. WebUI からペンディングクリップを DAW の新しい MIDI トラックにドラッグ＆ドロップします。
9. 再生し、追加したノートが聴こえることを確認します。

**合格基準:** ノートが再生されること。予期しないノートがないこと。書き込み前の `diff_clip_abc` が正確に 1 ノート追加を報告していること。

---

### TC-7: diff で意図しない編集が判明した場合の revert

**手順:**
1. 意図しない編集を行います（例: 全ノートの音価を 2 倍にする）。
2. `diff_clip_abc` → サマリーに予期しない変更が表示されることを確認します。
3. 書き込みを行わないか、書き込んだ場合は返された `undoToken` を使って `revert_clip` を実行します。

**合格基準:** revert 後に元の状態が復元されること。revert 後に `read_clip_as_abc` を呼び出すと編集前の ABC と一致すること。

---

## ユーザーによる手動操作が必要なステップ

以下のテストケースは DAW の前に人間がいる必要があり、自動化できません。

| TC | 手動操作が必要な内容 |
|---|---|
| TC-1 | MIDI クリップを描画し、`hasClip: true` を確認する |
| TC-6、ステップ 8 | WebUI からペンディングクリップを DAW の MIDI トラックにドラッグ |
| TC-6、ステップ 9 | 再生して追加ノートが聴こえることを確認 |
| TC-7 | revert 後に元のオーディオが復元されていることを確認 |

その他のステップ（TC-1〜TC-7 のツール呼び出し）は、プラグインが起動していれば Claude Code から実行できます。
