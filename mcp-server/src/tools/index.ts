import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { CoHarmoBridgeClient } from "../bridgeClient.js";
import { abcCodec, AbcParseError } from "../codec/abcCodec.js";
import { summarizeClip } from "../summarize.js";
import { diffClips } from "../clipDiff.js";
import type { MidiClip } from "../codec/MidiTextCodec.js";

export function registerTools(server: McpServer, bridge: CoHarmoBridgeClient): void {
  server.tool(
    "get_session",
    "Get current session info from the co-harmo plugin",
    {},
    async () => {
      try {
        const session = await bridge.getSession();
        return {
          content: [{ type: "text" as const, text: JSON.stringify(session, null, 2) }],
        };
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
          isError: true,
        };
      }
    }
  );

  server.tool(
    "read_clip_as_abc",
    "Read the current MIDI clip from the plugin and return it as ABC notation",
    {
      rangeBars: z
        .object({ start: z.number(), end: z.number() })
        .optional()
        .describe("Optional bar range to return (1-indexed, inclusive)"),
    },
    async ({ rangeBars }) => {
      try {
        const clipData = await bridge.readClip();

        const clip: MidiClip = {
          ppq: clipData.ppq,
          tempo: clipData.tempo,
          timeSignature: clipData.timeSignature,
          events: clipData.events,
        };

        let filtered = clip;
        if (rangeBars) {
          const ticksPerBar = clipData.ppq * 4 * (clipData.timeSignature[0] / clipData.timeSignature[1]);
          const startTick = (rangeBars.start - 1) * ticksPerBar;
          const endTick = rangeBars.end * ticksPerBar;
          filtered = {
            ...clip,
            events: clip.events.filter(
              (e) => e.tickOn >= startTick && e.tickOn < endTick
            ),
          };
        }

        const abc = abcCodec.encode(filtered);
        return {
          content: [{ type: "text" as const, text: abc }],
        };
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
          isError: true,
        };
      }
    }
  );

  server.tool(
    "write_clip_from_abc",
    "Decode ABC notation and write it to the plugin as a pending clip",
    {
      abc: z.string().describe("ABC notation string to write"),
      replaceRange: z
        .object({ startBar: z.number().int().positive(), endBar: z.number().int().positive() })
        .optional()
        .describe("Bar range to replace (1-indexed, inclusive). Omit to replace the whole clip."),
    },
    async ({ abc, replaceRange }) => {
      let clip: MidiClip;
      try {
        clip = abcCodec.decode(abc);
      } catch (err) {
        if (err instanceof AbcParseError) {
          return {
            content: [{
              type: "text" as const,
              text: `ABC parse error at line ${err.line}, col ${err.col}: ${err.message}`,
            }],
            isError: true,
          };
        }
        return {
          content: [{ type: "text" as const, text: `Decode error: ${err instanceof Error ? err.message : String(err)}` }],
          isError: true,
        };
      }

      try {
        const clipData = {
          sessionId: "",
          ppq: clip.ppq,
          tempo: clip.tempo,
          timeSignature: clip.timeSignature,
          events: clip.events,
        };
        const result = await bridge.writeClip(clipData, replaceRange);
        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify(result, null, 2),
          }],
        };
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
          isError: true,
        };
      }
    }
  );

  server.tool(
    "revert_clip",
    "Revert a pending clip write using an undo token",
    {
      undoToken: z.string().describe("The undo token returned by write_clip_from_abc"),
    },
    async ({ undoToken }) => {
      try {
        await bridge.revertClip(undoToken);
        return {
          content: [{ type: "text" as const, text: `Reverted clip ${undoToken}` }],
        };
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
          isError: true,
        };
      }
    }
  );

  server.tool(
    "summarize_clip",
    "Get a compact per-bar digest of the current clip (~2KB for 32 bars). Use this before read_clip_as_abc to decide which bars to fetch.",
    {
      maxBars: z.number().int().positive().optional()
        .describe("Maximum bars to include in digest (default 32)"),
    },
    async ({ maxBars }) => {
      try {
        const clipData = await bridge.readClip();
        const clip: MidiClip = {
          ppq: clipData.ppq,
          tempo: clipData.tempo,
          timeSignature: clipData.timeSignature,
          events: clipData.events,
        };
        const summary = summarizeClip(clip, maxBars ?? 32);
        // Emit compact form to keep Agent context usage low
        const output = {
          totalBars: summary.totalBars,
          bpm: summary.bpm,
          timeSignature: summary.timeSignature,
          trackHint: summary.trackHint,
          barDigest: summary.barDigestCompact,
        };
        return {
          content: [{ type: "text" as const, text: JSON.stringify(output) }],
        };
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
          isError: true,
        };
      }
    }
  );

  server.tool(
    "diff_clip_abc",
    "Compute a note-level diff between two extended-ABC strings and return a unified diff with a human-readable summary.",
    {
      before: z.string().describe("Original ABC notation"),
      after:  z.string().describe("Modified ABC notation"),
    },
    async ({ before, after }) => {
      let beforeClip: MidiClip, afterClip: MidiClip;
      try {
        beforeClip = abcCodec.decode(before);
      } catch (err) {
        const msg = err instanceof AbcParseError
          ? `Parse error in 'before' at line ${err.line}, col ${err.col}: ${err.message}`
          : `Decode error in 'before': ${err instanceof Error ? err.message : String(err)}`;
        return { content: [{ type: "text" as const, text: msg }], isError: true };
      }
      try {
        afterClip = abcCodec.decode(after);
      } catch (err) {
        const msg = err instanceof AbcParseError
          ? `Parse error in 'after' at line ${err.line}, col ${err.col}: ${err.message}`
          : `Decode error in 'after': ${err instanceof Error ? err.message : String(err)}`;
        return { content: [{ type: "text" as const, text: msg }], isError: true };
      }

      const result = diffClips(beforeClip, afterClip);
      const text = `${result.summary}\n\n${result.unifiedDiff}`;
      return {
        content: [{ type: "text" as const, text }],
      };
    }
  );
}
