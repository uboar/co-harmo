# M2 Manual Test — Plugin ↔ MCP-Server Read Path

## Prerequisites

- macOS, Xcode command-line tools, Ninja, Node 20
- Built all three components (`bash scripts/build.sh` or CMake + npm manually)

## Steps

### 1. Launch the Standalone plugin

```
open build/mac-debug/plugin/co-harmo_artefacts/Debug/Standalone/co-harmo.app
```

The plugin writes `~/Library/Application Support/co-harmo/bridge.json` on startup.
Verify the file exists and contains `port`, `token`, `pid`, `sessionId`.

### 2. Verify bridge.json

```
cat ~/Library/Application\ Support/co-harmo/bridge.json
```

Expected shape:
```json
{ "port": <number>, "token": "<uuid>", "pid": <number>, "sessionId": "<uuid>", "startedAt": "<iso>" }
```

### 3. Run the probe script

```
node scripts/m2-probe.mjs
```

Expected output:
```
Reading bridge config from: .../bridge.json
bridge.json OK  port=...  pid=...  session=...
get_session OK: { "sessionId": "...", "sampleRate": 44100, "bpm": 120, ... }
read_clip OK: 0 events  tempo=120  ppq=480
Probe PASSED
```

A `read_clip` result with 0 events is acceptable when no MIDI has been recorded yet.

### 4. Record a MIDI clip (optional but recommended)

1. In the plugin UI, arm the MIDI input and play/record a few notes.
2. Re-run `node scripts/m2-probe.mjs`.
3. Confirm `read_clip OK: N events` where N > 0.

### 5. Test via MCP tools directly

With the plugin running, start the MCP server in dev mode:

```
cd mcp-server && npm run dev
```

In a separate terminal or MCP client, call:

- `get_session` — should return session JSON
- `read_clip_as_abc` — should return ABC notation (empty staff if no notes)

### 6. Run the automated smoke script

```
bash scripts/m2-smoke.sh
```

This builds everything, launches the Standalone app, waits for `bridge.json`, and
runs the probe automatically.

## Pass criteria

| Check | Expected |
|---|---|
| `bridge.json` appears within 5 s of app launch | Yes |
| `get_session` returns valid JSON with `sessionId`, `bpm`, `sampleRate` | Yes |
| `read_clip` returns a `ClipData` object (events may be empty) | Yes |
| `read_clip_as_abc` returns an ABC string starting with `X:1` | Yes |
| No uncaught exceptions in plugin console or mcp-server stderr | Yes |

## Known limitations

- The CI `m2-smoke` job uses `continue-on-error: true` because GitHub macOS
  runners have no display; `open -a` may fail or the app may not initialise its
  audio engine headlessly. Local runs on a developer machine are the authoritative
  smoke test.
