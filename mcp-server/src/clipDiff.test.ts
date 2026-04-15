import { describe, it, expect } from "vitest";
import { diffClips } from "./clipDiff.js";
import type { MidiClip, NoteEvent } from "./codec/MidiTextCodec.js";

const BASE: MidiClip = { ppq: 480, tempo: 120, timeSignature: [4, 4], events: [] };
const PPQ = 480;

function note(tickOn: number, pitch: number, vel = 80, tickOff?: number): NoteEvent {
  return { tickOn, tickOff: tickOff ?? tickOn + PPQ, pitch, vel, channel: 0 };
}

describe("diffClips", () => {
  it("identical clips: no changes", () => {
    const clip: MidiClip = { ...BASE, events: [note(0, 60), note(PPQ, 62)] };
    const result = diffClips(clip, clip);
    expect(result.summary).toBe("no changes");
    expect(result.changes).toHaveLength(0);
    expect(result.tempoChanged).toBe(false);
  });

  it("note added", () => {
    const before: MidiClip = { ...BASE, events: [note(0, 60)] };
    const after:  MidiClip = { ...BASE, events: [note(0, 60), note(PPQ, 62)] };
    const result = diffClips(before, after);
    expect(result.summary).toContain("1 note added");
    const added = result.changes.filter(c => c.type === "added");
    expect(added).toHaveLength(1);
    expect(added[0]!.note.pitch).toBe(62);
  });

  it("note removed", () => {
    const before: MidiClip = { ...BASE, events: [note(0, 60), note(PPQ, 62)] };
    const after:  MidiClip = { ...BASE, events: [note(0, 60)] };
    const result = diffClips(before, after);
    expect(result.summary).toContain("1 note removed");
    const removed = result.changes.filter(c => c.type === "removed");
    expect(removed).toHaveLength(1);
    expect(removed[0]!.note.pitch).toBe(62);
  });

  it("velocity changed", () => {
    const before: MidiClip = { ...BASE, events: [note(0, 60, 80)] };
    const after:  MidiClip = { ...BASE, events: [note(0, 60, 100)] };
    const result = diffClips(before, after);
    expect(result.summary).toContain("velocity changed on 1 note");
    const velChg = result.changes.filter(c => c.type === "velChanged");
    expect(velChg[0]!.before!.vel).toBe(80);
    expect(velChg[0]!.note.vel).toBe(100);
  });

  it("tempo changed is flagged", () => {
    const before: MidiClip = { ...BASE, tempo: 120, events: [note(0, 60)] };
    const after:  MidiClip = { ...BASE, tempo: 140, events: [note(0, 60)] };
    const result = diffClips(before, after);
    expect(result.tempoChanged).toBe(true);
    expect(result.summary).toContain("tempo 120→140 bpm");
  });

  it("combined: add + remove + vel change", () => {
    const before: MidiClip = { ...BASE, events: [note(0, 60, 80), note(PPQ, 62, 80)] };
    const after:  MidiClip = { ...BASE, events: [note(0, 60, 100), note(PPQ * 2, 64, 80)] };
    const result = diffClips(before, after);
    expect(result.summary).toContain("added");
    expect(result.summary).toContain("removed");
    expect(result.summary).toContain("velocity changed");
  });

  it("unifiedDiff contains --- and +++ headers", () => {
    const before: MidiClip = { ...BASE, events: [note(0, 60)] };
    const after:  MidiClip = { ...BASE, events: [note(0, 62)] };
    const result = diffClips(before, after);
    expect(result.unifiedDiff).toContain("--- before");
    expect(result.unifiedDiff).toContain("+++ after");
  });

  it("unifiedDiff contains summary line", () => {
    const before: MidiClip = { ...BASE, events: [note(0, 60)] };
    const after:  MidiClip = { ...BASE, events: [note(0, 60), note(PPQ, 62)] };
    const result = diffClips(before, after);
    expect(result.unifiedDiff).toContain(`# ${result.summary}`);
  });
});
