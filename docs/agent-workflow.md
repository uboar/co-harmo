# co-harmo: Agent Workflow Guide

This document is the canonical reference for Claude Code and Codex when using co-harmo to assist with music production in a DAW. Read it before issuing any tool calls.

---

## 1. Install and Setup

### Plugin installation

1. Download the co-harmo VST3/AU bundle from the releases page.
2. Copy `co-harmo.vst3` (or `.component` for AU) into the appropriate DAW plugin folder:
   - macOS VST3: `~/Library/Audio/Plug-Ins/VST3/`
   - macOS AU: `~/Library/Audio/Plug-Ins/Components/`
   - Windows VST3: `C:\Program Files\Common Files\VST3\`
3. Rescan plugins in your DAW (Logic Pro, Reaper, Cubase, or Ableton).
4. Insert co-harmo on any MIDI or instrument track.

**Requirements:** macOS 12+ or Windows 10/11 with WebView2 runtime installed. Node 20+ is required for the MCP server.

### Register the MCP server

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

### How co-harmo discovers the plugin (bridge.json rendezvous)

When the plugin loads in the DAW it starts a local WebSocket server on a random port and writes a rendezvous file:

- macOS: `~/Library/Application Support/co-harmo/bridge.json`
- Windows: `%APPDATA%\co-harmo\bridge.json`

Contents:
```json
{ "port": 49217, "token": "a1b2c3d4..." }
```

The MCP server reads this file on startup to connect to the plugin. The token is required for the first WebSocket frame (`hello` auth handshake). If you need to override the port, set the environment variable `CO_HARMO_BRIDGE_PORT`.

---

## 2. The Agent Loop

Follow this sequence when helping a user with a MIDI clip:

```
open DAW
  └─ load co-harmo plugin on target track
       └─ play back or arm the MIDI clip you want to work with
            └─ call get_session          ← confirm connection and get clip metadata
                 └─ call summarize_clip  ← get a bar-level overview of the clip
                      └─ decide which bars are relevant
                           └─ call read_clip_as_abc { rangeBars: { start, end } }
                                └─ reason about the music
                                     └─ call write_clip_from_abc { abc, replaceRange? }
                                          └─ tell the user to drag the pending clip
                                             from the co-harmo webui to a DAW track
```

**Key points:**

- Always call `get_session` first to confirm the plugin is connected and a clip is loaded (`hasClip: true`).
- Use `summarize_clip` before `read_clip_as_abc` on long clips to avoid reading more tokens than needed.
- Pass `rangeBars` to `read_clip_as_abc` to limit the returned ABC to bars you actually need.
- After `write_clip_from_abc` succeeds the result contains an `undoToken`. Store it — you can pass it to `revert_clip` to undo the write.
- Before writing, use `diff_clip_abc { before: originalAbc, after: modifiedAbc }` to verify that your edits are exactly what you intended and to produce a human-readable change summary you can report to the user.
- The written clip is held in a *pending* layer. The user must drag it from the co-harmo WebUI panel onto a DAW track to commit it. No DAW API is involved; it is a standard MIDI file drag-and-drop.

---

## 3. Tool Reference

| Tool | Purpose | Key inputs | Key outputs | When to use |
|---|---|---|---|---|
| `get_session` | Confirm plugin connection; read session metadata | none | `sessionId`, `bpm`, `timeSignature`, `hasClip`, `clipLengthBars` | Always first |
| `summarize_clip` | Bar-level digest of the current clip | none | Compact ABC summary, bar count, note density per bar | Before reading long clips |
| `read_clip_as_abc` | Read MIDI clip as extended-ABC text | `rangeBars?: { start, end }` (1-indexed, inclusive) | Extended-ABC string | After summarizing, to get the music |
| `write_clip_from_abc` | Write modified ABC back to the plugin as a pending clip | `abc: string`, `replaceRange?: { startBar, endBar }` (1-indexed, inclusive) | `undoToken`, `tempMidiPath` | After reasoning about the music |
| `revert_clip` | Undo a pending clip write | `undoToken: string` | confirmation text | When the result is wrong and you want to roll back |
| `diff_clip_abc` | Note-level diff between two extended-ABC strings | `before: string`, `after: string` | Human-readable summary ("N notes added, M removed, velocity changed on K notes, tempo ...") + unified diff | Before writing, to verify edits; after writing, to explain changes to the user |

### get_session response fields

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

### write_clip_from_abc response fields

```jsonc
{
  "undoToken": "tok_...",
  "tempMidiPath": "~/.co-harmo/tmp/<sessionId>/<ts>.mid"
}
```

---

## 4. Extended-ABC Cheat Sheet

co-harmo uses a superset of standard ABC notation. The unit is `L:1/16` (one sixteenth note). Decorations are placed immediately before the note they modify.

### Decoration syntax

| Decoration | Meaning | Range / notes |
|---|---|---|
| `!vN!` | MIDI velocity | 0–127; default running value is **80**. Omit if unchanged. |
| `!t+N!` / `!t-N!` | Microtiming offset in ticks (PPQ=480) | Positive = late; negative = early; default is **0**. Omit if unchanged. |
| `!ccN=V!` | Insert CC event at same tick as the following note | N = controller number 0–127; V = value 0–127 |
| `!prog=N!` | Program change at same tick as the following note | N = 0–127 |

### Normalized decoration order

When writing ABC, always emit decorations in this order:

```
!vN! !t±N! !ccN=V! ... !prog=N!
```

This prevents spurious diffs when the model edits a clip.

### Running defaults (omit-if-unchanged rule)

The encoder tracks running values. A decoration is emitted only when it changes:

- Initial velocity: **80**
- Initial microtiming: **0** (no offset)

A clip where every note has velocity 80 and zero offset produces ABC with no decorations at all — just pitches and durations.

### ABC structure example

```abc
X:1
T:co-harmo clip
M:4/4
L:1/16
Q:1/4=120
K:C
!v90!C4 E4 G4 c4 | !v70!e4 g4 c'4 z4 | ...
```

### Rests

`z` followed by an optional duration in sixteenths, e.g. `z4` = quarter rest, `z` = sixteenth rest.

### Chords

Simultaneous notes in `[...]`, e.g. `[CEG]4` = C major quarter-note chord.

### Pitch notation

Standard ABC octave convention applies (`C` = middle C, `c` = one octave up, `c'` = two octaves up, `C,` = one octave below middle C). Accidentals: `^` = sharp, `_` = flat. Duration multipliers are in sixteenths (`C` = 1/16, `C4` = 1/4, `C8` = 1/2, `C16` = whole).

---

## 5. Typical User Prompts

These are examples of what users might say and the tool sequence you should use:

**"Harmonize this melody"**
1. `get_session` → confirm clip loaded
2. `summarize_clip` → check length
3. `read_clip_as_abc` → read the melody
4. Reason: add chord tones below each melody note
5. `write_clip_from_abc` with the harmonized ABC
6. Tell user to drag the pending clip from the plugin UI

**"Quantize to 1/8 swing 55%"**
1. `get_session`
2. `read_clip_as_abc`
3. Recalculate tick positions: on-beats stay, off-beats shifted to 55% into each beat (adjust `!t±N!` decorations accordingly)
4. `write_clip_from_abc`

**"Add a countermelody in bars 5–8"**
1. `get_session`
2. `read_clip_as_abc { rangeBars: { start: 5, end: 8 } }` — read only the target range
3. Compose countermelody in a compatible key/rhythm
4. `write_clip_from_abc { replaceRange: { startBar: 5, endBar: 8 } }`

**"Transpose up a perfect fifth"**
1. `get_session`
2. `read_clip_as_abc`
3. Add 7 semitones to every pitch (update note letters + accidentals accordingly)
4. `write_clip_from_abc`

**"Thin out the density in bars 3–4"**
1. `get_session`
2. `read_clip_as_abc { rangeBars: { start: 3, end: 4 } }`
3. Remove weaker off-beat notes to reduce density
4. `write_clip_from_abc { replaceRange: { startBar: 3, endBar: 4 } }`

---

## 6. Troubleshooting

### Plugin not detected / "bridge.json not found"

- Ensure the plugin is loaded in the DAW and the track is active (not bypassed).
- Check that the rendezvous file exists:
  - macOS: `~/Library/Application Support/co-harmo/bridge.json`
  - Windows: `%APPDATA%\co-harmo\bridge.json`
- If it is missing, remove and re-insert the plugin on the track to force a restart of the bridge server.
- Verify that no firewall or security software is blocking `127.0.0.1` on the port listed in `bridge.json`.

### Token mismatch / "Auth failed"

- The token in `bridge.json` is regenerated each time the plugin restarts. Restart the MCP server after reloading the plugin:
  ```
  claude mcp restart co-harmo
  ```
- If using `CO_HARMO_BRIDGE_PORT` override, confirm the port matches what is in `bridge.json`.

### ABC parse error on write

- The error message includes a line and column number: `ABC parse error at line N, col M: <reason>`.
- Fix the indicated position in the ABC string. Common causes:
  - Unclosed decoration `!` — every `!` must have a matching close `!`.
  - Duration `0` — minimum duration is `1` (one sixteenth).
  - Pitch out of MIDI range — valid MIDI pitches are 0–127 (roughly C-1 to G9).
  - `L:` field is not `L:1/16` — the codec only supports sixteenth-note units.

### Drag-and-drop not working

- The pending clip drag is initiated from the co-harmo WebUI panel inside the DAW. Click the drag handle next to the pending clip and drop it onto an empty area of a MIDI track.
- On macOS, grant the DAW "Accessibility" permission in System Settings → Privacy & Security if drag sources are blocked.
- On Windows, ensure the DAW is not running as Administrator (elevation breaks cross-process drag-and-drop).

### Audio glitches during MIDI write

- The write operation is non-destructive: the original clip is preserved in a snapshot until you accept or revert. If you hear glitches, call `revert_clip` with the `undoToken` to restore the previous state immediately.
- Avoid issuing `write_clip_from_abc` while the DAW transport is recording.
