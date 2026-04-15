import { describe, it, expect } from "vitest";
import { abcCodec, AbcParseError } from "./abcCodec.js";
import type { MidiClip } from "./MidiTextCodec.js";

const BASE_CLIP: MidiClip = {
  ppq: 480,
  tempo: 120,
  timeSignature: [4, 4],
  events: [],
};

function clip(events: MidiClip["events"], overrides: Partial<MidiClip> = {}): MidiClip {
  return { ...BASE_CLIP, ...overrides, events };
}

/** Encode → decode → encode stability check. */
function roundTripStable(c: MidiClip): void {
  const abc1 = abcCodec.encode(c);
  const decoded = abcCodec.decode(abc1);
  const abc2 = abcCodec.encode(decoded);
  expect(abc2).toBe(abc1);
}

// ─── encode ─────────────────────────────────────────────────────────────────

describe("abcCodec.encode", () => {
  it("produces a valid ABC header for an empty clip", () => {
    const abc = abcCodec.encode(BASE_CLIP);
    expect(abc).toContain("X:1");
    expect(abc).toContain("M:4/4");
    expect(abc).toContain("L:1/16");
    expect(abc).toContain("Q:1/4=120");
    expect(abc).toContain("K:C");
  });

  it("encodes a single middle-C quarter note (MIDI 60, 1 bar)", () => {
    const abc = abcCodec.encode(
      clip([{ tickOn: 0, tickOff: 480, pitch: 60, vel: 80, channel: 0 }])
    );
    expect(abc).toContain("C4");
    expect(abc).not.toContain("!v");
  });

  it("emits velocity decoration when vel differs from default 80", () => {
    const abc = abcCodec.encode(
      clip([{ tickOn: 0, tickOff: 480, pitch: 60, vel: 100, channel: 0 }])
    );
    expect(abc).toContain("!v100!");
  });

  it("suppresses repeated velocity decorations (running default)", () => {
    const events: MidiClip["events"] = [
      { tickOn: 0, tickOff: 480, pitch: 60, vel: 100, channel: 0 },
      { tickOn: 480, tickOff: 960, pitch: 62, vel: 100, channel: 0 },
    ];
    const abc = abcCodec.encode(clip(events));
    const count = (abc.match(/!v100!/g) ?? []).length;
    expect(count).toBe(1);
  });

  it("emits microtiming decoration when tickOn is off-grid", () => {
    const abc = abcCodec.encode(
      clip([{ tickOn: 10, tickOff: 490, pitch: 60, vel: 80, channel: 0 }])
    );
    expect(abc).toContain("!t+10!");
  });

  it("decoration order is v → t → cc → prog", () => {
    const abc = abcCodec.encode(
      clip(
        [{ tickOn: 10, tickOff: 490, pitch: 60, vel: 100, channel: 0 }],
        {
          ccEvents: [{ tick: 10, controller: 7, value: 64 }],
          programChanges: [{ tick: 10, channel: 0, program: 5 }],
        }
      )
    );
    const vPos = abc.indexOf("!v100!");
    const tPos = abc.indexOf("!t+10!");
    const ccPos = abc.indexOf("!cc7=64!");
    const progPos = abc.indexOf("!prog=5!");
    expect(vPos).toBeGreaterThanOrEqual(0);
    expect(tPos).toBeGreaterThan(vPos);
    expect(ccPos).toBeGreaterThan(tPos);
    expect(progPos).toBeGreaterThan(ccPos);
  });

  it("encodes a sharp note with ^ prefix (C#4 = MIDI 61)", () => {
    const abc = abcCodec.encode(
      clip([{ tickOn: 0, tickOff: 480, pitch: 61, vel: 80, channel: 0 }])
    );
    expect(abc).toContain("^C");
  });

  it("encodes octave above C4 as lowercase (C5 = MIDI 72)", () => {
    const abc = abcCodec.encode(
      clip([{ tickOn: 0, tickOff: 480, pitch: 72, vel: 80, channel: 0 }])
    );
    expect(abc).toContain("c4");
  });

  it("encodes octave below C4 with comma (C3 = MIDI 48)", () => {
    const abc = abcCodec.encode(
      clip([{ tickOn: 0, tickOff: 480, pitch: 48, vel: 80, channel: 0 }])
    );
    expect(abc).toContain("C,4");
  });

  it("fills rests between notes", () => {
    const events: MidiClip["events"] = [
      { tickOn: 0, tickOff: 480, pitch: 60, vel: 80, channel: 0 },
      { tickOn: 960, tickOff: 1440, pitch: 62, vel: 80, channel: 0 },
    ];
    const abc = abcCodec.encode(clip(events));
    expect(abc).toContain("z4");
  });

  it("snapshot: C major scale 1/8 notes", () => {
    const pitches = [60, 62, 64, 65, 67, 69, 71, 72];
    const events: MidiClip["events"] = pitches.map((pitch, i) => ({
      tickOn: i * 240,
      tickOff: (i + 1) * 240,
      pitch,
      vel: 80,
      channel: 0,
    }));
    const abc = abcCodec.encode(clip(events, { ppq: 480 }));
    expect(abc).toContain("C2");
    expect(abc).toContain("D2");
    expect(abc).toContain("E2");
    expect(abc).toContain("F2");
    expect(abc).toContain("G2");
    expect(abc).toContain("A2");
    expect(abc).toContain("B2");
    expect(abc).toContain("c2");
  });
});

// ─── decode ──────────────────────────────────────────────────────────────────

describe("abcCodec.decode", () => {
  it("parses header fields correctly", () => {
    const abc = "X:1\nT:test\nM:3/4\nL:1/16\nQ:1/4=90\nK:C\nz12 |]";
    const c = abcCodec.decode(abc);
    expect(c.tempo).toBe(90);
    expect(c.timeSignature).toEqual([3, 4]);
    expect(c.ppq).toBe(480);
  });

  it("decodes a single quarter note C4", () => {
    const abc = "X:1\nT:t\nM:4/4\nL:1/16\nQ:1/4=120\nK:C\nC4z12 |]";
    const c = abcCodec.decode(abc);
    expect(c.events).toHaveLength(1);
    expect(c.events[0]!.pitch).toBe(60);
    expect(c.events[0]!.tickOff - c.events[0]!.tickOn).toBe(4 * 120); // 4 sixteenths * 120 ticks
  });

  it("decodes velocity decoration and applies running default", () => {
    const abc = "X:1\nT:t\nM:4/4\nL:1/16\nQ:1/4=120\nK:C\n!v100!C4D4z8 |]";
    const c = abcCodec.decode(abc);
    expect(c.events[0]!.vel).toBe(100);
    expect(c.events[1]!.vel).toBe(100); // running default carries over
  });

  it("throws AbcParseError for invalid velocity value", () => {
    const abc = "X:1\nT:t\nM:4/4\nL:1/16\nQ:1/4=120\nK:C\n!v300!C4 |]";
    expect(() => abcCodec.decode(abc)).toThrow(AbcParseError);
    try {
      abcCodec.decode(abc);
    } catch (e) {
      expect(e).toBeInstanceOf(AbcParseError);
      expect((e as AbcParseError).message).toMatch(/velocity out of range/);
    }
  });

  it("decodes lowercase note as octave 5 (c = C5 = MIDI 72)", () => {
    const abc = "X:1\nT:t\nM:4/4\nL:1/16\nQ:1/4=120\nK:C\nc4z12 |]";
    const c = abcCodec.decode(abc);
    expect(c.events[0]!.pitch).toBe(72);
  });

  it("decodes comma octave modifier (C, = C3 = MIDI 48)", () => {
    const abc = "X:1\nT:t\nM:4/4\nL:1/16\nQ:1/4=120\nK:C\nC,4z12 |]";
    const c = abcCodec.decode(abc);
    expect(c.events[0]!.pitch).toBe(48);
  });

  it("decodes sharp (^C = C#4 = MIDI 61)", () => {
    const abc = "X:1\nT:t\nM:4/4\nL:1/16\nQ:1/4=120\nK:C\n^C4z12 |]";
    const c = abcCodec.decode(abc);
    expect(c.events[0]!.pitch).toBe(61);
  });
});

// ─── round-trip stability ────────────────────────────────────────────────────

describe("abcCodec round-trip (encode → decode → encode = stable)", () => {
  it("fixture 1: single note", () => {
    roundTripStable(clip([{ tickOn: 0, tickOff: 480, pitch: 60, vel: 80, channel: 0 }]));
  });

  it("fixture 2: C major scale 16th notes", () => {
    const pitches = [60, 62, 64, 65, 67, 69, 71, 72];
    const events: MidiClip["events"] = pitches.map((pitch, i) => ({
      tickOn: i * 120,
      tickOff: (i + 1) * 120,
      pitch,
      vel: 80,
      channel: 0,
    }));
    roundTripStable(clip(events));
  });

  it("fixture 3: velocity changes mid-bar", () => {
    const events: MidiClip["events"] = [
      { tickOn: 0,   tickOff: 120,  pitch: 60, vel: 100, channel: 0 },
      { tickOn: 120, tickOff: 240,  pitch: 62, vel: 64,  channel: 0 },
      { tickOn: 240, tickOff: 360,  pitch: 64, vel: 64,  channel: 0 },
      { tickOn: 360, tickOff: 480,  pitch: 65, vel: 80,  channel: 0 },
    ];
    roundTripStable(clip(events));
  });

  it("fixture 4: microtiming offsets", () => {
    const events: MidiClip["events"] = [
      { tickOn: 5,   tickOff: 125,  pitch: 60, vel: 80, channel: 0 },
      { tickOn: 120, tickOff: 240,  pitch: 62, vel: 80, channel: 0 },
    ];
    roundTripStable(clip(events));
  });
});
