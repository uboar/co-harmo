import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { CoHarmoBridgeClient } from "../bridgeClient.js";
import { abcCodec } from "../codec/abcCodec.js";
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
}
