import { describe, it, expect } from "vitest";
import type { MidiTextCodec, MidiClip } from "./MidiTextCodec.js";

describe("MidiTextCodec interface", () => {
  it("is satisfied by a stub implementation", () => {
    const stub: MidiTextCodec = {
      encode: (_clip: MidiClip) => "",
      decode: (_text: string) => ({
        ppq: 480,
        temposBpm: [120],
        timeSignatures: [{ numerator: 4, denominator: 4 }],
        events: [],
      }),
    };

    const clip: MidiClip = {
      ppq: 480,
      temposBpm: [120],
      timeSignatures: [{ numerator: 4, denominator: 4 }],
      events: [],
    };

    expect(stub.encode(clip)).toBe("");
    expect(stub.decode("").ppq).toBe(480);
  });
});
