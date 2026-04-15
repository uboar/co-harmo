# M4 Manual Test — summarize_clip + diff_clip_abc in a Real DAW

## Prerequisites

- macOS or Windows with Logic Pro / Reaper / Cubase / Ableton Live installed
- co-harmo VST3 built and installed (see `docs/agent-workflow.md` §1)
- MCP server registered: `claude mcp add co-harmo -- npx -y co-harmo-mcp`
- Node 20+, mcp-server built (`npm run build` in `mcp-server/`)

## Setup

1. Open your DAW and create a new project at 120 BPM, 4/4.
2. Insert **co-harmo** on a MIDI instrument track.
3. Draw or import a MIDI clip of at least 8 bars. A C-major scale repeated over 4 bars works well.
4. Confirm `~/Library/Application Support/co-harmo/bridge.json` (macOS) or `%APPDATA%\co-harmo\bridge.json` (Windows) exists with a valid `port` and `token`.

## Test Cases

### TC-1: summarize_clip — basic digest

**Steps:**
1. In Claude Code, call `get_session` → confirm `hasClip: true` and `clipLengthBars >= 4`.
2. Call `summarize_clip` (no arguments).

**Expected:**
- Returns JSON with `totalBars`, `bpm`, `timeSignature`, `trackHint`, and `barDigest`.
- `barDigest` has one entry per bar, each with `noteCount`, `pitchRange [lo, hi]`, `avgVel`, `density`.
- `trackHint` is one of `"melody"`, `"chord/poly"`, `"lead/high"`, `"bass"`, `"empty"`.
- Total response under 2 KB for a 32-bar clip.

**Pass criteria:** No error; `totalBars` matches the clip you drew; `noteCount > 0` for bars with notes.

---

### TC-2: summarize_clip — maxBars parameter

**Steps:**
1. Call `summarize_clip { maxBars: 2 }`.

**Expected:**
- `barDigest` contains exactly 2 entries (bars 1 and 2).
- `totalBars` still reflects the full clip length.

**Pass criteria:** `barDigest.length === 2`.

---

### TC-3: diff_clip_abc — no-change baseline

**Steps:**
1. Call `read_clip_as_abc` to get the ABC string (call it `abc`).
2. Call `diff_clip_abc { before: abc, after: abc }`.

**Expected:**
- `summary` is `"no changes"`.
- `unifiedDiff` contains `"(no textual changes)"`.

**Pass criteria:** Zero changes reported.

---

### TC-4: diff_clip_abc — velocity edit

**Steps:**
1. Take the ABC string from TC-3.
2. Manually prepend `!v100!` to the first note of bar 1 in the `after` copy.
3. Call `diff_clip_abc { before: <original>, after: <modified> }`.

**Expected:**
- `summary` includes `"velocity changed on N notes"`.
- `unifiedDiff` shows a `−` line with the original bar and a `+` line with the modified bar.

**Pass criteria:** At least one `velChanged` entry; diff shows the modified bar.

---

### TC-5: diff_clip_abc — note added

**Steps:**
1. Take the original ABC. In the `after` copy, replace a rest `z4` in bar 2 with a note (e.g. `G4`).
2. Call `diff_clip_abc { before: <original>, after: <modified> }`.

**Expected:**
- `summary` includes `"1 note added"`.

**Pass criteria:** `"added"` count ≥ 1.

---

### TC-6: full agent loop with M4 tools

**Steps:**
1. `get_session` → note `clipLengthBars`.
2. `summarize_clip` → identify a sparse bar (low `noteCount`).
3. `read_clip_as_abc { rangeBars: { start: <sparse bar>, end: <sparse bar> } }`.
4. Add a passing note to fill the sparse bar.
5. `diff_clip_abc { before: <original>, after: <modified> }` → verify the single addition.
6. `write_clip_from_abc { abc: <modified>, replaceRange: { startBar: <n>, endBar: <n> } }`.
7. In the co-harmo WebUI, confirm the pending clip appears.
8. Drag the pending clip from the WebUI onto a new MIDI track in the DAW.
9. Play back → the added note should be audible.

**Pass criteria:** Note plays back; no unexpected notes; `diff_clip_abc` reported exactly 1 note added before the write.

---

### TC-7: revert after diff shows wrong edit

**Steps:**
1. Make an unintended edit (e.g., double all note durations).
2. `diff_clip_abc` → confirm summary shows unexpected changes.
3. Do NOT write. (Or write, then `revert_clip` with the returned `undoToken`.)

**Pass criteria:** Revert restores original state; `read_clip_as_abc` after revert matches the pre-edit ABC.

---

## Pending user action

The following test cases require a human at a DAW and cannot be automated:

| TC | What requires human action |
|---|---|
| TC-1 | Draw the MIDI clip and confirm `hasClip: true` |
| TC-6, step 8 | Drag pending clip from WebUI to DAW MIDI track |
| TC-6, step 9 | Listen to playback to confirm added note is audible |
| TC-7 | Verify original audio is restored after revert |

All other steps (TC-1 through TC-7 tool calls) can be run from Claude Code once the plugin is running.
