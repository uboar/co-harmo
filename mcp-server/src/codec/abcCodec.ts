import type { MidiClip, MidiTextCodec, NoteEvent, CcEvent, ProgramChangeEvent } from "./MidiTextCodec.js";

export class AbcParseError extends Error {
  constructor(
    message: string,
    public readonly line: number,
    public readonly col: number,
  ) {
    super(message);
    this.name = "AbcParseError";
  }
}

// ─── Encode helpers ──────────────────────────────────────────────────────────

const PITCH_NAMES = ["C", "D", "E", "F", "G", "A", "B"];
const SEMI_IN_OCT = [0, 2, 4, 5, 7, 9, 11];

function midiPitchToAbc(pitch: number): string {
  const semitone = pitch % 12;
  const midiOctave = Math.floor(pitch / 12) - 1;

  let closestIdx = 0;
  let closestDist = 12;
  for (let i = 0; i < SEMI_IN_OCT.length; i++) {
    const d = Math.abs(SEMI_IN_OCT[i]! - semitone);
    if (d < closestDist) { closestDist = d; closestIdx = i; }
  }
  const naturalSemi = SEMI_IN_OCT[closestIdx]!;
  const accidental = semitone > naturalSemi ? "^" : semitone < naturalSemi ? "_" : "";
  const baseName = PITCH_NAMES[closestIdx]!;

  if (midiOctave === 4) return accidental + baseName;
  if (midiOctave === 5) return accidental + baseName.toLowerCase();
  if (midiOctave > 5)   return accidental + baseName.toLowerCase() + "'".repeat(midiOctave - 5);
  return accidental + baseName + ",".repeat(4 - midiOctave);
}

function abcDuration(sixteenths: number): string {
  if (sixteenths === 1) return "";
  return String(sixteenths);
}

interface DecState { velocity: number; microtiming: number; }

function buildDecorations(
  vel: number, tickOn: number, quantizedTick: number,
  ccHere: CcEvent[], progHere: ProgramChangeEvent | undefined,
  state: DecState,
): string {
  let dec = "";
  if (vel !== state.velocity)                { dec += `!v${vel}!`; state.velocity = vel; }
  const offset = tickOn - quantizedTick;
  if (offset !== state.microtiming)          { dec += offset >= 0 ? `!t+${offset}!` : `!t${offset}!`; state.microtiming = offset; }
  for (const cc of ccHere)                   { dec += `!cc${cc.controller}=${cc.value}!`; }
  if (progHere !== undefined)                { dec += `!prog=${progHere.program}!`; }
  return dec;
}

// ─── Decode helpers ───────────────────────────────────────────────────────────

// Map ABC note letter (lowercase) → semitone offset within octave
const NOTE_SEMI: Record<string, number> = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };

/**
 * Scan one note token from `body` starting at `pos`.
 * Format: [^_]* [a-gA-G] [',]* [0-9]*
 * Returns { token, advance } — token is the raw string, advance is chars consumed.
 */
function scanNoteToken(body: string, pos: number): { token: string; advance: number } {
  let i = pos;
  // accidentals
  while (i < body.length && (body[i] === "^" || body[i] === "_")) i++;
  // letter (required)
  if (i < body.length && /[a-gA-G]/.test(body[i]!)) i++;
  // octave modifiers
  while (i < body.length && (body[i] === "'" || body[i] === ",")) i++;
  // digits only
  while (i < body.length && /\d/.test(body[i]!)) i++;
  return { token: body.slice(pos, i), advance: i - pos };
}

/** Parse a pre-scanned note token like "^C,4" or "c'2" or "_B". */
function parseNote(
  token: string,
  lineNo: number,
  colBase: number,
): { pitch: number; sixteenths: number } {
  let i = 0;

  let accidentalShift = 0;
  while (i < token.length && (token[i] === "^" || token[i] === "_")) {
    accidentalShift += token[i] === "^" ? 1 : -1;
    i++;
  }

  const letterRaw = token[i];
  if (!letterRaw || !/[a-gA-G]/.test(letterRaw)) {
    throw new AbcParseError(`Expected note letter, got '${token[i] ?? "<end>"}'`, lineNo, colBase + i);
  }
  const isLower = letterRaw === letterRaw.toLowerCase();
  const letter = letterRaw.toLowerCase();
  const semi = NOTE_SEMI[letter]!;
  i++;

  let octaveShift = isLower ? 5 : 4;
  while (i < token.length && (token[i] === "'" || token[i] === ",")) {
    octaveShift += token[i] === "'" ? 1 : -1;
    i++;
  }

  let sixteenths = 1;
  if (i < token.length) {
    const durStr = token.slice(i);
    const dur = parseInt(durStr, 10);
    if (isNaN(dur) || dur <= 0) {
      throw new AbcParseError(`Invalid duration '${durStr}'`, lineNo, colBase + i);
    }
    sixteenths = dur;
  }

  const pitch = (octaveShift + 1) * 12 + semi + accidentalShift;
  if (pitch < 0 || pitch > 127) {
    throw new AbcParseError(`Pitch ${pitch} out of MIDI range`, lineNo, colBase);
  }
  return { pitch, sixteenths };
}

/** Parse inline decorations from a string starting at pos. Returns { decorations, advance }. */
interface ParsedDecorations {
  velocity?: number;
  microtiming?: number;
  ccEvents: Array<{ controller: number; value: number }>;
  program?: number;
  advance: number;
}

function parseDecorations(body: string, startPos: number, lineNo: number): ParsedDecorations {
  const result: ParsedDecorations = { ccEvents: [], advance: 0 };
  let i = startPos;
  while (i < body.length && body[i] === "!") {
    const close = body.indexOf("!", i + 1);
    if (close === -1) throw new AbcParseError("Unclosed decoration '!'", lineNo, i);
    const inner = body.slice(i + 1, close);
    // velocity
    const vMatch = /^v(\d+)$/.exec(inner);
    if (vMatch) {
      const v = parseInt(vMatch[1]!, 10);
      if (v < 0 || v > 127) throw new AbcParseError(`velocity out of range: ${v}`, lineNo, i);
      result.velocity = v;
    }
    // microtiming
    const tMatch = /^t([+-]\d+)$/.exec(inner);
    if (tMatch) result.microtiming = parseInt(tMatch[1]!, 10);
    // CC
    const ccMatch = /^cc(\d+)=(\d+)$/.exec(inner);
    if (ccMatch) result.ccEvents.push({ controller: parseInt(ccMatch[1]!, 10), value: parseInt(ccMatch[2]!, 10) });
    // program change
    const progMatch = /^prog=(\d+)$/.exec(inner);
    if (progMatch) result.program = parseInt(progMatch[1]!, 10);

    i = close + 1;
  }
  result.advance = i - startPos;
  return result;
}

// ─── Main codec ───────────────────────────────────────────────────────────────

export const abcCodec: MidiTextCodec = {
  encode(clip: MidiClip, name = "co-harmo clip"): string {
    const { ppq, tempo, timeSignature, events, ccEvents = [], programChanges = [] } = clip;
    const [tsNum, tsDenom] = timeSignature;
    const ticksPerSixteenth = ppq / 4;
    const ticksPerBar = ppq * 4 * (tsNum / tsDenom);

    const ccByTick = new Map<number, CcEvent[]>();
    for (const cc of ccEvents) {
      if (!ccByTick.has(cc.tick)) ccByTick.set(cc.tick, []);
      ccByTick.get(cc.tick)!.push(cc);
    }
    const progByTick = new Map<number, ProgramChangeEvent>();
    for (const pc of programChanges) progByTick.set(pc.tick, pc);

    const sorted = [...events].sort((a, b) => a.tickOn - b.tickOn);
    const lastTick = sorted.length > 0 ? Math.max(...sorted.map(e => e.tickOff)) : ticksPerBar;
    const totalBars = Math.max(1, Math.ceil(lastTick / ticksPerBar));

    const header = ["X:1", `T:${name}`, `M:${tsNum}/${tsDenom}`, "L:1/16", `Q:1/4=${Math.round(tempo)}`, "K:C"].join("\n");

    const decState: DecState = { velocity: 80, microtiming: 0 };
    const bars: string[] = [];

    for (let bar = 0; bar < totalBars; bar++) {
      const barStartTick = bar * ticksPerBar;
      const barEndTick = barStartTick + ticksPerBar;
      const barNotes = sorted.filter(e => e.tickOn >= barStartTick && e.tickOn < barEndTick);

      let barStr = "";
      let cursor = barStartTick;

      for (const note of barNotes) {
        const quantizedOn  = Math.round(note.tickOn  / ticksPerSixteenth) * ticksPerSixteenth;
        const quantizedOff = Math.round(note.tickOff / ticksPerSixteenth) * ticksPerSixteenth;
        const durSixteenths = Math.max(1, Math.round((quantizedOff - quantizedOn) / ticksPerSixteenth));

        const restTicks = quantizedOn - cursor;
        if (restTicks > 0) {
          const restS = Math.round(restTicks / ticksPerSixteenth);
          if (restS > 0) barStr += `z${abcDuration(restS)}`;
        }

        const dec = buildDecorations(note.vel, note.tickOn, quantizedOn, ccByTick.get(note.tickOn) ?? [], progByTick.get(note.tickOn), decState);
        barStr += dec + midiPitchToAbc(note.pitch) + abcDuration(durSixteenths);
        cursor = quantizedOn + durSixteenths * ticksPerSixteenth;
      }

      const remaining = Math.round((barEndTick - cursor) / ticksPerSixteenth);
      if (remaining > 0) barStr += `z${abcDuration(remaining)}`;
      bars.push(barStr || `z${abcDuration(tsNum * (16 / tsDenom))}`);
    }

    const lines: string[] = [];
    for (let i = 0; i < bars.length; i += 4) lines.push(bars.slice(i, i + 4).join(" | "));
    return header + "\n" + lines.join(" |\n") + " |]";
  },

  decode(abc: string): MidiClip {
    const rawLines = abc.split("\n");
    const lines = rawLines.map(l => l.trim());

    // ── Parse header fields ──
    let ppq = 480;
    let tempo = 120;
    let tsNum = 4, tsDenom = 4;

    let bodyStartLine = 0;
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i]!;
      if (/^X:/i.test(l)) continue;
      if (/^T:/i.test(l)) continue;
      if (/^K:/i.test(l)) { bodyStartLine = i + 1; break; }
      const mMatch = /^M:(\d+)\/(\d+)/i.exec(l);
      if (mMatch) { tsNum = parseInt(mMatch[1]!, 10); tsDenom = parseInt(mMatch[2]!, 10); }
      const lMatch = /^L:/i.exec(l);
      if (lMatch) {
        // L:1/16 assumed — validate
        if (!/^L:1\/16/i.test(l)) {
          throw new AbcParseError("Only L:1/16 is supported", i + 1, 0);
        }
      }
      const qMatch = /^Q:1\/4=(\d+)/i.exec(l);
      if (qMatch) tempo = parseInt(qMatch[1]!, 10);
    }

    const ticksPerSixteenth = ppq / 4;
    const ticksPerBar = ppq * 4 * (tsNum / tsDenom);

    const events: NoteEvent[] = [];
    const ccEvents: CcEvent[] = [];
    const programChanges: ProgramChangeEvent[] = [];

    // Running decode state
    let runVel = 80;
    let runTiming = 0;
    let cursorTick = 0;

    // ── Parse body ──
    const bodyLines = lines.slice(bodyStartLine);

    for (let li = 0; li < bodyLines.length; li++) {
      const lineNo = bodyStartLine + li + 1;
      let body = bodyLines[li]!;
      // Strip bar-line terminators and split on bar lines
      body = body.replace(/\|\]$/, "").replace(/\|$/, "");
      const barTokens = body.split("|");

      for (const barRaw of barTokens) {
        const barBody = barRaw.trim();
        if (!barBody) continue;

        const barStartTick = cursorTick;
        let pos = 0;

        while (pos < barBody.length) {
          const ch = barBody[pos]!;

          // Skip whitespace
          if (ch === " " || ch === "\t") { pos++; continue; }

          // Decorations
          if (ch === "!") {
            const dec = parseDecorations(barBody, pos, lineNo);
            if (dec.velocity !== undefined) runVel = dec.velocity;
            if (dec.microtiming !== undefined) runTiming = dec.microtiming;
            // CC and prog are attached to the *next* note — stash them
            // We apply them when we encounter the note below
            pos += dec.advance;
            // Peek ahead to get the note context, but we need to store these
            // until the note is parsed. Re-enter the loop with stashed decorations.

            // Instead: parse decorations AND the following note together.
            // Collect stashed CC/prog for the upcoming note.
            const stashedCc = dec.ccEvents;
            const stashedProg = dec.program;

            // Skip whitespace after decorations
            while (pos < barBody.length && (barBody[pos] === " " || barBody[pos] === "\t")) pos++;

            if (pos >= barBody.length) break;

            const ch2 = barBody[pos]!;
            if (ch2 === "z") {
              // rest — decorations on a rest are unusual but tolerated
              pos++;
              let durStr = "";
              while (pos < barBody.length && /\d/.test(barBody[pos]!)) { durStr += barBody[pos]; pos++; }
              const dur = durStr ? parseInt(durStr, 10) : 1;
              cursorTick += dur * ticksPerSixteenth;
            } else if (ch2 === "[") {
              // chord
              pos++; // skip [
              const chordEnd = barBody.indexOf("]", pos);
              if (chordEnd === -1) throw new AbcParseError("Unclosed chord '['", lineNo, pos);
              const chordStr = barBody.slice(pos, chordEnd);
              pos = chordEnd + 1;
              let durStr = "";
              while (pos < barBody.length && /\d/.test(barBody[pos]!)) { durStr += barBody[pos]; pos++; }
              const chordDur = durStr ? parseInt(durStr, 10) : 1;

              const tickOn = cursorTick + runTiming;
              const tickOff = tickOn + chordDur * ticksPerSixteenth;

              // Parse each note in the chord
              let ci = 0;
              while (ci < chordStr.length) {
                let noteToken = "";
                if (chordStr[ci] === "^" || chordStr[ci] === "_") noteToken += chordStr[ci++];
                if (ci < chordStr.length && /[a-gA-G]/.test(chordStr[ci]!)) noteToken += chordStr[ci++];
                while (ci < chordStr.length && (chordStr[ci] === "'" || chordStr[ci] === ",")) noteToken += chordStr[ci++];
                if (noteToken) {
                  const { pitch } = parseNote(noteToken, lineNo, pos);
                  events.push({ tickOn, tickOff, pitch, vel: runVel, channel: 0 });
                } else {
                  ci++;
                }
              }
              for (const cc of stashedCc) ccEvents.push({ tick: cursorTick, controller: cc.controller, value: cc.value });
              if (stashedProg !== undefined) programChanges.push({ tick: cursorTick, channel: 0, program: stashedProg });
              cursorTick += chordDur * ticksPerSixteenth;
            } else {
              // single note
              const colBase2 = pos;
              const { token: noteToken, advance: noteAdv } = scanNoteToken(barBody, pos);
              if (!noteToken) throw new AbcParseError(`Unexpected character '${barBody[pos]}'`, lineNo, pos);
              pos += noteAdv;
              const { pitch, sixteenths } = parseNote(noteToken, lineNo, colBase2);
              const tickOn = cursorTick + runTiming;
              const tickOff = tickOn + sixteenths * ticksPerSixteenth;
              events.push({ tickOn, tickOff, pitch, vel: runVel, channel: 0 });
              for (const cc of stashedCc) ccEvents.push({ tick: cursorTick, controller: cc.controller, value: cc.value });
              if (stashedProg !== undefined) programChanges.push({ tick: cursorTick, channel: 0, program: stashedProg });
              cursorTick += sixteenths * ticksPerSixteenth;
            }
            continue;
          }

          // Rest
          if (ch === "z") {
            pos++;
            let durStr = "";
            while (pos < barBody.length && /\d/.test(barBody[pos]!)) { durStr += barBody[pos]; pos++; }
            const dur = durStr ? parseInt(durStr, 10) : 1;
            cursorTick += dur * ticksPerSixteenth;
            continue;
          }

          // Chord
          if (ch === "[") {
            pos++;
            const chordEnd = barBody.indexOf("]", pos);
            if (chordEnd === -1) throw new AbcParseError("Unclosed chord '['", lineNo, pos);
            const chordStr = barBody.slice(pos, chordEnd);
            pos = chordEnd + 1;
            let durStr = "";
            while (pos < barBody.length && /\d/.test(barBody[pos]!)) { durStr += barBody[pos]; pos++; }
            const chordDur = durStr ? parseInt(durStr, 10) : 1;

            const tickOn = cursorTick + runTiming;
            const tickOff = tickOn + chordDur * ticksPerSixteenth;

            let ci = 0;
            while (ci < chordStr.length) {
              let noteToken = "";
              if (chordStr[ci] === "^" || chordStr[ci] === "_") noteToken += chordStr[ci++];
              if (ci < chordStr.length && /[a-gA-G]/.test(chordStr[ci]!)) noteToken += chordStr[ci++];
              while (ci < chordStr.length && (chordStr[ci] === "'" || chordStr[ci] === ",")) noteToken += chordStr[ci++];
              if (noteToken) {
                const { pitch } = parseNote(noteToken, lineNo, pos);
                events.push({ tickOn, tickOff, pitch, vel: runVel, channel: 0 });
              } else {
                ci++;
              }
            }
            cursorTick += chordDur * ticksPerSixteenth;
            continue;
          }

          // Note (accidentals + letter + octave modifiers + duration)
          if (/[a-gA-G^_]/.test(ch)) {
            const colBase = pos;
            const { token: noteToken, advance: noteAdv } = scanNoteToken(barBody, pos);
            pos += noteAdv;
            const { pitch, sixteenths } = parseNote(noteToken, lineNo, colBase);
            const tickOn = cursorTick + runTiming;
            const tickOff = tickOn + sixteenths * ticksPerSixteenth;
            events.push({ tickOn, tickOff, pitch, vel: runVel, channel: 0 });
            cursorTick += sixteenths * ticksPerSixteenth;
            continue;
          }

          throw new AbcParseError(`Unexpected character '${ch}'`, lineNo, pos);
        }

        // Advance cursor to next bar boundary
        const barUsed = cursorTick - barStartTick;
        const barLen = ticksPerBar;
        if (barUsed < barLen) cursorTick = barStartTick + barLen;
      }
    }

    return {
      ppq,
      tempo,
      timeSignature: [tsNum, tsDenom],
      events,
      ccEvents: ccEvents.length > 0 ? ccEvents : undefined,
      programChanges: programChanges.length > 0 ? programChanges : undefined,
    };
  },
};
