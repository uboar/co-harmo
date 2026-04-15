import type { MidiClip, MidiTextCodec, NoteEvent, CcEvent, ProgramChangeEvent } from "./MidiTextCodec.js";

// MIDI pitch → ABC note name (C4 = middle C = MIDI 60)
// ABC convention: C octave (MIDI 60-71) = uppercase C D E F G A B
//                 c octave (MIDI 72-83) = lowercase c d e f g a b
//                 Higher: c' d' ...  Lower: C, D, (with commas below C4)
const PITCH_NAMES = ["C", "D", "E", "F", "G", "A", "B"];
// semitone offsets within an octave for natural notes
const SEMI_IN_OCT = [0, 2, 4, 5, 7, 9, 11];

function midiPitchToAbc(pitch: number): string {
  const semitone = pitch % 12;
  const midiOctave = Math.floor(pitch / 12) - 1; // MIDI octave (-1 to 9)

  // Find the closest natural note (no accidentals for M2 — accidentals out of scope)
  let closestIdx = 0;
  let closestDist = 12;
  for (let i = 0; i < SEMI_IN_OCT.length; i++) {
    const d = Math.abs(SEMI_IN_OCT[i]! - semitone);
    if (d < closestDist) {
      closestDist = d;
      closestIdx = i;
    }
  }
  // Sharps: if semitone is a sharp, use ^ prefix
  const naturalSemi = SEMI_IN_OCT[closestIdx]!;
  const accidental = semitone > naturalSemi ? "^" : semitone < naturalSemi ? "_" : "";
  const baseName = PITCH_NAMES[closestIdx]!;

  // ABC octave mapping: octave 4 (MIDI) → uppercase, octave 5 → lowercase
  // octave 6+ → lowercase + ', octave 3 → uppercase + ,
  const abcOctave4 = 4; // C4 = uppercase no modifier
  if (midiOctave === abcOctave4) {
    return accidental + baseName;
  } else if (midiOctave === abcOctave4 + 1) {
    return accidental + baseName.toLowerCase();
  } else if (midiOctave > abcOctave4 + 1) {
    return accidental + baseName.toLowerCase() + "'".repeat(midiOctave - (abcOctave4 + 1));
  } else {
    // octave 3 and below
    return accidental + baseName + ",".repeat(abcOctave4 - midiOctave);
  }
}

function abcDuration(sixteenths: number): string {
  if (sixteenths === 1) return "";     // L:1/16 unit = no suffix
  if (sixteenths === 2) return "2";
  if (sixteenths === 4) return "4";
  if (sixteenths === 8) return "8";
  if (sixteenths === 16) return "16";
  // Odd durations: use fraction notation
  return String(sixteenths);
}

interface DecorationState {
  velocity: number;     // running default 80
  microtiming: number;  // running default 0
}

function buildDecorations(
  vel: number,
  tickOn: number,
  quantizedTick: number,
  ccEventsAtTick: CcEvent[],
  progAtTick: ProgramChangeEvent | undefined,
  state: DecorationState,
): string {
  let dec = "";
  // Normalized order: v → t → cc* → prog
  if (vel !== state.velocity) {
    dec += `!v${vel}!`;
    state.velocity = vel;
  }
  const offset = tickOn - quantizedTick;
  if (offset !== state.microtiming) {
    dec += offset >= 0 ? `!t+${offset}!` : `!t${offset}!`;
    state.microtiming = offset;
  }
  for (const cc of ccEventsAtTick) {
    dec += `!cc${cc.controller}=${cc.value}!`;
  }
  if (progAtTick !== undefined) {
    dec += `!prog=${progAtTick.program}!`;
  }
  return dec;
}

export const abcCodec: MidiTextCodec = {
  encode(clip: MidiClip, name = "co-harmo clip"): string {
    const { ppq, tempo, timeSignature, events, ccEvents = [], programChanges = [] } = clip;
    const [tsNum, tsDenom] = timeSignature;
    const ticksPerSixteenth = ppq / 4;
    const ticksPerBar = ppq * 4 * (tsNum / tsDenom);

    // Build lookup maps for CC and program events by tick
    const ccByTick = new Map<number, CcEvent[]>();
    for (const cc of ccEvents) {
      if (!ccByTick.has(cc.tick)) ccByTick.set(cc.tick, []);
      ccByTick.get(cc.tick)!.push(cc);
    }
    const progByTick = new Map<number, ProgramChangeEvent>();
    for (const pc of programChanges) {
      progByTick.set(pc.tick, pc);
    }

    // Sort events by tickOn
    const sorted = [...events].sort((a, b) => a.tickOn - b.tickOn);

    // Determine total length in bars
    const lastTick = sorted.length > 0
      ? Math.max(...sorted.map(e => e.tickOff))
      : ticksPerBar;
    const totalBars = Math.max(1, Math.ceil(lastTick / ticksPerBar));

    // Build ABC header
    const header = [
      "X:1",
      `T:${name}`,
      `M:${tsNum}/${tsDenom}`,
      "L:1/16",
      `Q:1/4=${Math.round(tempo)}`,
      "K:C",
    ].join("\n");

    // Group notes into bars, filling rests
    const decState: DecorationState = { velocity: 80, microtiming: 0 };
    const bars: string[] = [];

    for (let bar = 0; bar < totalBars; bar++) {
      const barStartTick = bar * ticksPerBar;
      const barEndTick = barStartTick + ticksPerBar;
      const barNotes = sorted.filter(
        e => e.tickOn >= barStartTick && e.tickOn < barEndTick
      );

      let barStr = "";
      let cursor = barStartTick; // in ticks

      for (const note of barNotes) {
        // Quantize onset to nearest 1/16 grid
        const quantizedOn = Math.round(note.tickOn / ticksPerSixteenth) * ticksPerSixteenth;
        const quantizedOff = Math.round(note.tickOff / ticksPerSixteenth) * ticksPerSixteenth;
        const durationSixteenths = Math.max(1, Math.round((quantizedOff - quantizedOn) / ticksPerSixteenth));

        // Rest before note
        const restTicks = quantizedOn - cursor;
        if (restTicks > 0) {
          const restSixteenths = Math.round(restTicks / ticksPerSixteenth);
          if (restSixteenths > 0) {
            barStr += `z${abcDuration(restSixteenths)}`;
          }
        }

        const ccHere = ccByTick.get(note.tickOn) ?? [];
        const progHere = progByTick.get(note.tickOn);
        const dec = buildDecorations(note.vel, note.tickOn, quantizedOn, ccHere, progHere, decState);

        barStr += dec + midiPitchToAbc(note.pitch) + abcDuration(durationSixteenths);
        cursor = quantizedOn + durationSixteenths * ticksPerSixteenth;
      }

      // Fill trailing rest to end of bar
      const remainingTicks = barEndTick - cursor;
      if (remainingTicks > 0) {
        const restSixteenths = Math.round(remainingTicks / ticksPerSixteenth);
        if (restSixteenths > 0) {
          barStr += `z${abcDuration(restSixteenths)}`;
        }
      }

      bars.push(barStr || `z${abcDuration(tsNum * (16 / tsDenom))}`);
    }

    // Join bars with | separators, 4 bars per line
    const lines: string[] = [];
    for (let i = 0; i < bars.length; i += 4) {
      lines.push(bars.slice(i, i + 4).join(" | "));
    }
    const body = lines.join(" |\n") + " |]";

    return header + "\n" + body;
  },

  decode(_abc: string): MidiClip {
    throw new Error("ABC decode not implemented in M2");
  },
};
