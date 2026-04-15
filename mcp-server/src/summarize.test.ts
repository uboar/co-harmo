import { describe, it, expect } from "vitest";
import { summarizeClip } from "./summarize.js";
import type { MidiClip } from "./codec/MidiTextCodec.js";

const BASE: MidiClip = { ppq: 480, tempo: 120, timeSignature: [4, 4], events: [] };

function makeNote(bar: number, beatOffset: number, pitch: number, vel: number, ppq = 480): MidiClip["events"][0] {
  const ticksPerBar = ppq * 4;
  const tickOn = bar * ticksPerBar + beatOffset * ppq;
  return { tickOn, tickOff: tickOn + ppq, pitch, vel, channel: 0 };
}

describe("summarizeClip", () => {
  it("empty clip: 1 bar, no notes", () => {
    const s = summarizeClip(BASE);
    expect(s.totalBars).toBe(1);
    expect(s.bpm).toBe(120);
    expect(s.timeSignature).toEqual([4, 4]);
    expect(s.barDigest).toHaveLength(1);
    expect(s.barDigest[0]!.noteCount).toBe(0);
    expect(s.barDigest[0]!.pitchRange).toEqual([0, 0]);
    expect(s.barDigest[0]!.avgVel).toBe(0);
  });

  it("4-bar clip: correct per-bar note counts", () => {
    const events = [
      makeNote(0, 0, 60, 80), makeNote(0, 1, 62, 80),   // bar 1: 2 notes
      makeNote(1, 0, 64, 90),                              // bar 2: 1 note
      // bar 3: empty
      makeNote(3, 0, 65, 100), makeNote(3, 2, 67, 80), makeNote(3, 3, 69, 80), // bar 4: 3 notes
    ];
    const clip: MidiClip = { ...BASE, events };
    const s = summarizeClip(clip);
    expect(s.totalBars).toBe(4);
    expect(s.barDigest).toHaveLength(4);
    expect(s.barDigest[0]!.noteCount).toBe(2);
    expect(s.barDigest[1]!.noteCount).toBe(1);
    expect(s.barDigest[2]!.noteCount).toBe(0);
    expect(s.barDigest[3]!.noteCount).toBe(3);
  });

  it("4-bar clip: pitch range and avgVel correct", () => {
    const events = [
      makeNote(0, 0, 48, 64),
      makeNote(0, 1, 72, 96),
    ];
    const clip: MidiClip = { ...BASE, events };
    const s = summarizeClip(clip);
    expect(s.barDigest[0]!.pitchRange).toEqual([48, 72]);
    expect(s.barDigest[0]!.avgVel).toBe(80); // (64+96)/2
  });

  it("respects maxBars cap", () => {
    const events = Array.from({ length: 64 }, (_, i) => makeNote(i, 0, 60, 80));
    const clip: MidiClip = { ...BASE, events };
    const s = summarizeClip(clip, 8);
    expect(s.totalBars).toBe(64);
    expect(s.barDigest).toHaveLength(8);
  });

  it("32-bar clip compact output stays under 2KB", () => {
    const events = Array.from({ length: 32 * 4 }, (_, i) => {
      const bar = Math.floor(i / 4);
      const beat = i % 4;
      return makeNote(bar, beat, 60 + (i % 12), 80);
    });
    const clip: MidiClip = { ...BASE, events };
    const s = summarizeClip(clip, 32);
    // The compact representation the tool will send to agents
    const compactJson = JSON.stringify({
      totalBars: s.totalBars,
      bpm: s.bpm,
      timeSignature: s.timeSignature,
      trackHint: s.trackHint,
      barDigest: s.barDigestCompact,
    });
    expect(compactJson.length).toBeLessThan(2048);
  });

  it("density is notes per beat", () => {
    // 4 notes in bar 0 of a 4/4 bar = 1.0 notes/beat
    const events = [0, 1, 2, 3].map(beat => makeNote(0, beat, 60, 80));
    const clip: MidiClip = { ...BASE, events };
    const s = summarizeClip(clip);
    expect(s.barDigest[0]!.density).toBe(1.0);
  });

  it("trackHint: bass for low notes", () => {
    const events = [makeNote(0, 0, 28, 80), makeNote(0, 1, 33, 80)];
    const s = summarizeClip({ ...BASE, events });
    expect(s.trackHint).toBe("bass");
  });

  it("trackHint: lead/high for high notes", () => {
    const events = [makeNote(0, 0, 80, 80), makeNote(0, 1, 84, 80)];
    const s = summarizeClip({ ...BASE, events });
    expect(s.trackHint).toBe("lead/high");
  });
});
