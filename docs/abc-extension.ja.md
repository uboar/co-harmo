# co-harmo 拡張 ABC 仕様

> English version: [abc-extension.md](./abc-extension.md)

co-harmo は、ABC 記譜法（バージョン 2.1）の厳格なサブセットを MIDI 固有データ用インラインデコレーションで拡張した形式を使用します。このドキュメントが正式仕様です。

---

## 文法

```
abc-file    ::= header body
header      ::= field-X field-T field-M field-L field-Q field-K
field-X     ::= "X:" integer NEWLINE
field-T     ::= "T:" text NEWLINE
field-M     ::= "M:" integer "/" integer NEWLINE
field-L     ::= "L:1/16" NEWLINE          -- 1/16 のみ対応
field-Q     ::= "Q:1/4=" integer NEWLINE  -- テンポ（BPM）
field-K     ::= "K:C" NEWLINE             -- キーは常に C（クロマチック）

body        ::= bar ("|" bar)* "|]"
bar         ::= element*
element     ::= decorations note
              | decorations chord
              | rest

decorations ::= decoration*
decoration  ::= "!" dec-body "!"
dec-body    ::= velocity | microtiming | cc-event | prog-change

velocity    ::= "v" integer               -- 0..127
microtiming ::= "t" sign integer          -- 符号付きティックオフセット
cc-event    ::= "cc" integer "=" integer  -- コントローラー 0..127、値 0..127
prog-change ::= "prog=" integer           -- プログラム 0..127

sign        ::= "+" | "-"

note        ::= accidental* letter octave-mod* duration?
accidental  ::= "^" | "_"
letter      ::= [a-gA-G]
octave-mod  ::= "'" | ","
duration    ::= integer                   -- 16 分音符倍率、デフォルト 1

chord       ::= "[" note+ "]" duration?
rest        ::= "z" duration?

integer     ::= [0-9]+
```

---

## デコレーションのセマンティクス

### `!vN!` — MIDI ベロシティ

継続ベロシティを N（0–127）に設定します。直後のノートに適用されます。デフォルトの初期値は **80** です。継続値から変化がない場合は省略されます。

### `!t+N!` / `!t-N!` — マイクロタイミングオフセット

ノートの実際のティック位置を、クォンタイズされたグリッド位置から N ティックずらします。PPQ は 480 固定です。正のオフセットはグリッドより *遅れ*、負は *早め* を意味します。デフォルトは **0** です。変化がない場合は省略されます。

### `!ccN=V!` — コントロールチェンジ

後続ノートと同じティックに MIDI CC イベントを挿入します。N はコントローラー番号（0–127）、V は値（0–127）です。1 つのノートの前に複数の CC デコレーションを置くことができます。CC デコレーションは休符ではなく後続ノートに付属します。

### `!prog=N!` — プログラムチェンジ

後続ノートと同じティックにプログラムチェンジイベントを挿入します。N はプログラム番号（0–127）です。

---

## エンコード正規化ルール

エンコーダーは常にこの正規順序でデコレーションを出力します。

```
!vN! !t±N! !ccN=V! [追加の !ccN=V! ...] !prog=N!
```

ルール:
1. `!vN!` は現在の継続ベロシティと異なる場合のみ出力します。
2. `!t±N!` は現在の継続マイクロタイミングオフセットと異なる場合のみ出力します。
3. そのノートのティックにある `!ccN=V!` デコレーションをすべて、コントローラー番号の昇順で出力します。
4. そのティックにプログラムチェンジがある場合は `!prog=N!` を最後に出力します。
5. すべてのデコレーションがデフォルト値かつ変化なしの場合、そのノートにはデコレーショントークンを出力しません。

---

## デコードルール

1. 継続ベロシティの初期値は **80**、継続マイクロタイミングの初期値は **0** です。
2. `!vN!` は継続ベロシティを更新します。以降のノートは次の変更まで新しい値を使用します。
3. `!t±N!` は継続マイクロタイミングオフセットを更新します。実際の `tickOn` = グリッドティック + オフセットです。
4. `!ccN=V!` と `!prog=N!` は一時保存され、*次の* ノートのティック位置に付属します。カーソルには影響しません。
5. 和音は `[` ブラケットの前にあるデコレーションを共有します。和音内の全ノートが同じティック・ベロシティ・タイミングオフセットを受け取ります。
6. 休符（`z`）はカーソルを進めますが、デコレーションを持ちません。
7. 小節内のノート音価の合計が小節を満たさない場合、カーソルは自動的に次の小節境界まで進みます。
8. `L:1/16` 以外の `L:` フィールドはパースエラーになります。

---

## 音価テーブル

| ABC トークン | 16 分音符数 | 音符の値 |
|---|---|---|
| `C`（サフィックスなし） | 1 | 1/16 |
| `C2` | 2 | 1/8 |
| `C4` | 4 | 1/4（4 分音符） |
| `C6` | 6 | 付点 1/4 |
| `C8` | 8 | 1/2（2 分音符） |
| `C12` | 12 | 付点 1/2 |
| `C16` | 16 | 全音符 |

---

## 音高表記

標準 ABC のオクターブ規則と MIDI マッピング:

| ABC | オクターブ | MIDI ピッチの例 |
|---|---|---|
| `C,,` | 2 | 36（C2） |
| `C,` | 3 | 48（C3） |
| `C`（大文字） | 4 | 60（ミドル C、C4） |
| `c`（小文字） | 5 | 72（C5） |
| `c'` | 6 | 84（C6） |
| `c''` | 7 | 96（C7） |

臨時記号: `^` = +1 半音（シャープ）、`_` = -1 半音（フラット）。複数の臨時記号を重ねられます: `^^C` = C ダブルシャープ。

---

## 最小例

```abc
X:1
T:co-harmo clip
M:4/4
L:1/16
Q:1/4=120
K:C
C4 E4 G4 z4 | c4 G4 E4 C4 |]
```

120 BPM の 2 小節クリップ。全ノートのベロシティはデフォルトの 80、マイクロタイミングなし。

---

## 拡張デコレーションを使った例

```abc
X:1
T:groove example
M:4/4
L:1/16
Q:1/4=96
K:C
!v100!C4 !v70!!t+12!E4 !v100!G4 !v70!!t+12!c4 |
!cc7=64!!v90![CEG]8 z8 |]
```

小節 1: 強拍（vel 100）と少し遅め・弱め（vel 70、+12 ティック）のノートを交互に配置。
小節 2: expression CC7=64 付き・ベロシティ 90 の C メジャー 4 分音符和音、続いて 2 分音符休符。

---

## エラー条件

| 条件 | エラー |
|---|---|
| `L:` フィールドが `1/16` でない | Parse error: "Only L:1/16 is supported" |
| `!` デコレーションが閉じていない | Parse error: "Unclosed decoration '!'" |
| 音価の整数が 0 または負 | Parse error: "Invalid duration" |
| MIDI ピッチが 0–127 の範囲外 | Parse error: "Pitch N out of MIDI range" |
| ベロシティが 0–127 の範囲外 | Parse error: "velocity out of range" |
| 和音 `[` が閉じていない | Parse error: "Unclosed chord '['" |
| 本文中に予期しない文字 | Parse error: "Unexpected character 'X'" |

すべてのパースエラーは `ABC parse error at line N, col M: <reason>` の形式で行番号と列番号を含みます。
