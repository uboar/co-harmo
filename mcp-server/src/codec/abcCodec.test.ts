import { describe, it, expect } from "vitest";
import { abcCodec } from "./abcCodec.js";
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
    // tickOn=0, tickOff=480 (1 quarter at ppq=480) = 4 sixteenth units
    const abc = abcCodec.encode(
      clip([{ tickOn: 0, tickOff: 480, pitch: 60, vel: 80, channel: 0 }])
    );
    // C4 = uppercase C, duration 4 sixteenths
    expect(abc).toContain("C4");
    // no velocity decoration because vel=80 is the default
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
    // !v100! should appear once, not twice
    const count = (abc.match(/!v100!/g) ?? []).length;
    expect(count).toBe(1);
  });

  it("emits microtiming decoration when tickOn is off-grid", () => {
    // tickOn=10 ticks early (quantized = 0, offset = +10)
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
    // Two quarter notes separated by a quarter rest
    const events: MidiClip["events"] = [
      { tickOn: 0, tickOff: 480, pitch: 60, vel: 80, channel: 0 },
      { tickOn: 960, tickOff: 1440, pitch: 62, vel: 80, channel: 0 },
    ];
    const abc = abcCodec.encode(clip(events));
    expect(abc).toContain("z4"); // quarter rest between them
  });

  it("snapshot: C major scale 1/8 notes", () => {
    const pitches = [60, 62, 64, 65, 67, 69, 71, 72]; // C D E F G A B c
    const events: MidiClip["events"] = pitches.map((pitch, i) => ({
      tickOn: i * 240,
      tickOff: (i + 1) * 240,
      pitch,
      vel: 80,
      channel: 0,
    }));
    const abc = abcCodec.encode(clip(events, { ppq: 480 }));
    // Each eighth note = 2 sixteenths → suffix "2"
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

describe("abcCodec.decode", () => {
  it("throws not-implemented in M2", () => {
    expect(() => abcCodec.decode("X:1")).toThrow("not implemented");
  });
});
