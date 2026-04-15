# co-harmo

co-harmo is a VST3/AU plugin that lets Claude Code, Codex, and other AI agents participate in music production directly inside your DAW. The plugin exposes the current MIDI clip over a local MCP server so an agent can read, reason about, and rewrite MIDI using a token-efficient text representation — without touching raw binary MIDI or requiring any DAW-specific scripting.

---

## Architecture

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

The plugin and MCP server rendezvous via `~/Library/Application Support/co-harmo/bridge.json` (macOS) or `%APPDATA%\co-harmo\bridge.json` (Windows), which the plugin writes on startup with the port and auth token.

---

## Quickstart

### Requirements

- macOS 12+ or Windows 10/11 with WebView2 runtime
- Node 20+
- A VST3- or AU-capable DAW (Logic Pro, Reaper, Cubase, Ableton Live, etc.)

### 1. Install the plugin

Copy `co-harmo.vst3` (or `.component` for AU on macOS) to your DAW's plugin folder and rescan:

- macOS VST3: `~/Library/Audio/Plug-Ins/VST3/`
- macOS AU: `~/Library/Audio/Plug-Ins/Components/`
- Windows VST3: `C:\Program Files\Common Files\VST3\`

### 2. Register the MCP server

```bash
claude mcp add co-harmo -- npx -y co-harmo-mcp
```

### 3. Connect and use

1. Open your DAW and insert co-harmo on a MIDI or instrument track.
2. Load or record a MIDI clip on that track.
3. Start Claude Code in your project directory.
4. Ask Claude to help with the clip:

```
Harmonize the melody in bars 1–4 of the current clip.
```

Claude will call `get_session`, read the clip as ABC notation, reason about the music, and write a modified clip back. The result appears as a pending clip in the co-harmo plugin panel. Drag it from the panel onto a DAW track to commit it.

For the full agent workflow, tool reference, and extended-ABC syntax, see:

- [docs/agent-workflow.md](docs/agent-workflow.md) — setup, the agent loop, tool reference, typical prompts, troubleshooting
- [docs/abc-extension.md](docs/abc-extension.md) — formal spec of the extended-ABC format

---

## Build from Source

```bash
# Clone with submodules (JUCE 8.x is fetched via CMake CPM)
git clone --recurse-submodules https://github.com/your-org/co-harmo
cd co-harmo

# Plugin (macOS)
cmake --preset mac-release
cmake --build --preset mac-release

# MCP server
cd mcp-server
npm install
npm run build

# Web UI (bundled into plugin Resources)
cd ../webui
npm install
npm run build
```

CI builds for macOS and Windows run on every push via `.github/workflows/ci.yml`.

---

## Status

| Milestone | Status |
|---|---|
| M1: scaffold (JUCE plugin + MCP server + WebUI) | Done |
| M2: MIDI read path (get_session, read_clip_as_abc) | Done |
| M3: MIDI write path (write_clip_from_abc, pending layer, drag-drop) | Done |
| M4: agent experience polish (summarize_clip, docs) | Done |

**In scope:** MIDI note data (pitch, velocity, timing, CC, program change), bidirectional read/write, undo tokens, pending layer with drag-and-drop commit.

**Out of scope (MVP):** audio generation, MPE/polyphonic expression, multi-track simultaneous editing, automatic DAW track insertion (requires DAW-specific APIs), MIDI 2.0.