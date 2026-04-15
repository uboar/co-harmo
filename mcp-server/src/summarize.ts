import type { MidiClip, NoteEvent } from "./codec/MidiTextCodec.js";

export interface BarDigest {
  bar: number;           // 1-indexed
  noteCount: number;
  pitchRange: [number, number];  // [lo, hi] MIDI pitch, [0,0] if no notes
  avgVel: number;        // 0 if no notes
  density: number;       // notes per beat (0–∞)
}

export interface ClipSummary {
  totalBars: number;
  bpm: number;
  timeSignature: [number, number];
  trackHint: string;
  /** Compact string per bar: "bar:noteCount:lo-hi:avgVel:density" */
  barDigest: BarDigest[];
  /** Compact single-string form for size-sensitive contexts */
  barDigestCompact: string;
}

/** Build a compact per-bar digest. Stays well under 2KB for 32 bars. */
export function summarizeClip(clip: MidiClip, maxBars = 32): ClipSummary {
  const { ppq, tempo, timeSignature, events } = clip;
  const [tsNum, tsDenom] = timeSignature;
  const ticksPerBar = ppq * 4 * (tsNum / tsDenom);

  const sorted = [...events].sort((a, b) => a.tickOn - b.tickOn);
  const lastTick = sorted.length > 0 ? Math.max(...sorted.map(e => e.tickOff)) : ticksPerBar;
  const totalBars = Math.max(1, Math.ceil(lastTick / ticksPerBar));
  const barsToDigest = Math.min(totalBars, maxBars);

  const barDigest: BarDigest[] = [];
  const compactRows: string[] = [];

  for (let bar = 0; bar < barsToDigest; bar++) {
    const startTick = bar * ticksPerBar;
    const endTick = startTick + ticksPerBar;
    const barNotes = sorted.filter(e => e.tickOn >= startTick && e.tickOn < endTick);

    let lo = 127, hi = 0, velSum = 0;
    for (const n of barNotes) {
      if (n.pitch < lo) lo = n.pitch;
      if (n.pitch > hi) hi = n.pitch;
      velSum += n.vel;
    }
    const nc = barNotes.length;
    const beatsPerBar = tsNum;
    const density = nc > 0 ? Math.round((nc / beatsPerBar) * 10) / 10 : 0;
    const avgVel = nc > 0 ? Math.round(velSum / nc) : 0;
    const pitchRange: [number, number] = nc > 0 ? [lo, hi] : [0, 0];

    barDigest.push({ bar: bar + 1, noteCount: nc, pitchRange, avgVel, density });
    // compact: "b1:n2:48-72:v80:d1.0"
    compactRows.push(`b${bar + 1}:n${nc}:${pitchRange[0]}-${pitchRange[1]}:v${avgVel}:d${density}`);
  }

  const trackHint = inferTrackHint(sorted);
  const barDigestCompact = compactRows.join(",");

  return { totalBars, bpm: Math.round(tempo), timeSignature, trackHint, barDigest, barDigestCompact };
}

/** Heuristic track-type hint from pitch distribution. */
function inferTrackHint(events: NoteEvent[]): string {
  if (events.length === 0) return "empty";
  const pitches = events.map(e => e.pitch);
  const avg = pitches.reduce((s, p) => s + p, 0) / pitches.length;
  const span = Math.max(...pitches) - Math.min(...pitches);
  if (avg < 40) return "bass";
  if (avg > 72) return "lead/high";
  if (span > 24) return "chord/poly";
  return "melody";
}
