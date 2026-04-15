# co-harmo Extended-ABC Specification

co-harmo uses a strict subset of ABC notation (version 2.1) extended with inline decorations for MIDI-specific data. This document is the authoritative specification.

---

## Grammar

```
abc-file    ::= header body
header      ::= field-X field-T field-M field-L field-Q field-K
field-X     ::= "X:" integer NEWLINE
field-T     ::= "T:" text NEWLINE
field-M     ::= "M:" integer "/" integer NEWLINE
field-L     ::= "L:1/16" NEWLINE          -- only 1/16 is supported
field-Q     ::= "Q:1/4=" integer NEWLINE  -- tempo in BPM
field-K     ::= "K:C" NEWLINE             -- key is always C (chromatic)

body        ::= bar ("|" bar)* "|]"
bar         ::= element*
element     ::= decorations note
              | decorations chord
              | rest

decorations ::= decoration*
decoration  ::= "!" dec-body "!"
dec-body    ::= velocity | microtiming | cc-event | prog-change

velocity    ::= "v" integer               -- 0..127
microtiming ::= "t" sign integer          -- signed tick offset
cc-event    ::= "cc" integer "=" integer  -- controller 0..127, value 0..127
prog-change ::= "prog=" integer           -- program 0..127

sign        ::= "+" | "-"

note        ::= accidental* letter octave-mod* duration?
accidental  ::= "^" | "_"
letter      ::= [a-gA-G]
octave-mod  ::= "'" | ","
duration    ::= integer                   -- sixteenth-note multiplier, default 1

chord       ::= "[" note+ "]" duration?
rest        ::= "z" duration?

integer     ::= [0-9]+
```

---

## Decoration Semantics

### `!vN!` — MIDI velocity

Sets the running velocity to N (0–127). Applied to the note that immediately follows. Default initial value is **80**. Omitted when unchanged from the running value.

### `!t+N!` / `!t-N!` — Microtiming offset

Shifts the note's actual tick position by N ticks relative to its quantized grid position. PPQ is fixed at 480. A positive offset means the note is played *after* the grid; negative means *before*. Default is **0**. Omitted when unchanged.

### `!ccN=V!` — Control Change

Inserts a MIDI CC event at the same tick as the following note. N is the controller number (0–127), V is the value (0–127). Multiple CC decorations may precede a single note. CC decorations are attached to the note that follows, not to a rest.

### `!prog=N!` — Program Change

Inserts a program change event at the same tick as the following note. N is the program number (0–127).

---

## Encoding Normalization Rules

The encoder always outputs decorations in this canonical order:

```
!vN! !t±N! !ccN=V! [additional !ccN=V! ...] !prog=N!
```

Rules:
1. Emit `!vN!` only when velocity differs from the current running value.
2. Emit `!t±N!` only when the microtiming offset differs from the current running offset.
3. Emit all `!ccN=V!` decorations for the note's tick, in ascending controller-number order.
4. Emit `!prog=N!` last if a program change occurs at this tick.
5. When all decorations are at default and unchanged, no decoration token is emitted for that note.

---

## Decoding Rules

1. Running velocity starts at **80**; running microtiming starts at **0**.
2. Each `!vN!` updates the running velocity; subsequent notes use the new value until changed again.
3. Each `!t±N!` updates the running microtiming offset; the actual `tickOn` = grid tick + offset.
4. `!ccN=V!` and `!prog=N!` are stashed and attached to the *next* note's tick position. They do not affect the cursor.
5. Chords share the decorations that precede the `[` bracket; all notes in the chord receive the same tick, velocity, and timing offset.
6. Rests (`z`) advance the cursor but carry no decorations.
7. If a bar's note durations do not fill the bar, the cursor is advanced to the next bar boundary automatically.
8. `L:` fields other than `L:1/16` are rejected with a parse error.

---

## Duration Table

| ABC token | Sixteenths | Note value |
|---|---|---|
| `C` (no suffix) | 1 | 1/16 |
| `C2` | 2 | 1/8 |
| `C4` | 4 | 1/4 (quarter) |
| `C6` | 6 | dotted 1/4 |
| `C8` | 8 | 1/2 (half) |
| `C12` | 12 | dotted 1/2 |
| `C16` | 16 | whole |

---

## Pitch Notation

Standard ABC octave convention with MIDI mapping:

| ABC | Octave | Example MIDI pitch |
|---|---|---|
| `C,,` | 2 | 36 (C2) |
| `C,` | 3 | 48 (C3) |
| `C` (uppercase) | 4 | 60 (middle C, C4) |
| `c` (lowercase) | 5 | 72 (C5) |
| `c'` | 6 | 84 (C6) |
| `c''` | 7 | 96 (C7) |

Accidentals: `^` = +1 semitone (sharp), `_` = -1 semitone (flat). Multiple accidentals stack: `^^C` = C double-sharp.

---

## Minimal Example

```abc
X:1
T:co-harmo clip
M:4/4
L:1/16
Q:1/4=120
K:C
C4 E4 G4 z4 | c4 G4 E4 C4 |]
```

A two-bar clip at 120 BPM, all notes at default velocity 80, no microtiming.

---

## Example with Extended Decorations

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

Bar 1: alternating strong (vel 100) and slightly late/soft (vel 70, +12 ticks) notes.
Bar 2: a C major quarter-note chord with expression CC7=64 at velocity 90, followed by a half-bar rest.

---

## Error Conditions

| Condition | Error |
|---|---|
| `L:` field is not `1/16` | Parse error: "Only L:1/16 is supported" |
| Unclosed `!` decoration | Parse error: "Unclosed decoration '!'" |
| Duration integer is 0 or negative | Parse error: "Invalid duration" |
| MIDI pitch outside 0–127 | Parse error: "Pitch N out of MIDI range" |
| Velocity outside 0–127 | Parse error: "velocity out of range" |
| Unclosed chord `[` | Parse error: "Unclosed chord '['" |
| Unexpected character in body | Parse error: "Unexpected character 'X'" |

All parse errors include line and column numbers in the format: `ABC parse error at line N, col M: <reason>`.
