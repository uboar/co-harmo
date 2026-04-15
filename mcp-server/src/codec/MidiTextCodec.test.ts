import { describe, it, expect } from "vitest";
import type { MidiTextCodec, MidiClip } from "./MidiTextCodec.js";

describe("MidiTextCodec interface", () => {
  it("is satisfied by a stub implementation", () => {
    const emptyClip: MidiClip = {
      ppq: 480,
      tempo: 120,
      timeSignature: [4, 4],
      events: [],
    };
    const stub: MidiTextCodec = {
      encode: (_clip: MidiClip) => "",
      decode: (_text: string) => emptyClip,
    };
    expect(stub.encode(emptyClip)).toBe("");
    expect(stub.decode("").ppq).toBe(480);
  });
});
