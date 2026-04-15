import type { MidiClip, NoteEvent } from "./codec/MidiTextCodec.js";
import { abcCodec } from "./codec/abcCodec.js";

export interface NoteChange {
  type: "added" | "removed" | "velChanged" | "timingChanged";
  note: NoteEvent;
  before?: NoteEvent;  // for changed notes
}

export interface ClipDiffResult {
  summary: string;
  changes: NoteChange[];
  unifiedDiff: string;
  tempoChanged: boolean;
  timeSigChanged: boolean;
}

// ─── LCS on note events ──────────────────────────────────────────────────────

/** Key that identifies "same note" regardless of attribute changes. */
function noteKey(n: NoteEvent): string {
  return `${n.tickOn}:${n.pitch}:${n.channel}`;
}

/** Simple O(n·m) LCS on note key sequences. Returns matching index pairs [ai, bi]. */
function lcsNoteMatches(as: NoteEvent[], bs: NoteEvent[]): Array<[number, number]> {
  const n = as.length, m = bs.length;
  // dp[i][j] = LCS length for as[0..i) and bs[0..j)
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      if (noteKey(as[i - 1]!) === noteKey(bs[j - 1]!)) {
        dp[i]![j] = dp[i - 1]![j - 1]! + 1;
      } else {
        dp[i]![j] = Math.max(dp[i - 1]![j]!, dp[i]![j - 1]!);
      }
    }
  }
  // Backtrack
  const matches: Array<[number, number]> = [];
  let i = n, j = m;
  while (i > 0 && j > 0) {
    if (noteKey(as[i - 1]!) === noteKey(bs[j - 1]!)) {
      matches.unshift([i - 1, j - 1]);
      i--; j--;
    } else if (dp[i - 1]![j]! >= dp[i]![j - 1]!) {
      i--;
    } else {
      j--;
    }
  }
  return matches;
}

// ─── Diff computation ─────────────────────────────────────────────────────────

export function diffClips(before: MidiClip, after: MidiClip): ClipDiffResult {
  const aNotes = [...before.events].sort((a, b) => a.tickOn - b.tickOn || a.pitch - b.pitch);
  const bNotes = [...after.events].sort((a, b) => a.tickOn - b.tickOn || a.pitch - b.pitch);

  const matches = lcsNoteMatches(aNotes, bNotes);
  const matchedA = new Set(matches.map(([ai]) => ai));
  const matchedB = new Set(matches.map(([, bi]) => bi));

  const changes: NoteChange[] = [];

  // Removed: in A but not matched
  for (let ai = 0; ai < aNotes.length; ai++) {
    if (!matchedA.has(ai)) changes.push({ type: "removed", note: aNotes[ai]! });
  }
  // Added: in B but not matched
  for (let bi = 0; bi < bNotes.length; bi++) {
    if (!matchedB.has(bi)) changes.push({ type: "added", note: bNotes[bi]! });
  }
  // Changed attributes on matched pairs
  for (const [ai, bi] of matches) {
    const a = aNotes[ai]!, b = bNotes[bi]!;
    if (a.vel !== b.vel) changes.push({ type: "velChanged", note: b, before: a });
    if (a.tickOn !== b.tickOn) changes.push({ type: "timingChanged", note: b, before: a });
  }

  const added    = changes.filter(c => c.type === "added").length;
  const removed  = changes.filter(c => c.type === "removed").length;
  const velChg   = changes.filter(c => c.type === "velChanged").length;
  const timChg   = changes.filter(c => c.type === "timingChanged").length;

  const tempoChanged   = before.tempo !== after.tempo;
  const timeSigChanged = before.timeSignature[0] !== after.timeSignature[0] ||
                         before.timeSignature[1] !== after.timeSignature[1];

  const parts: string[] = [];
  if (added)       parts.push(`${added} note${added !== 1 ? "s" : ""} added`);
  if (removed)     parts.push(`${removed} note${removed !== 1 ? "s" : ""} removed`);
  if (velChg)      parts.push(`velocity changed on ${velChg} note${velChg !== 1 ? "s" : ""}`);
  if (timChg)      parts.push(`timing changed on ${timChg} note${timChg !== 1 ? "s" : ""}`);
  if (tempoChanged) parts.push(`tempo ${before.tempo}→${after.tempo} bpm`);
  if (timeSigChanged) parts.push(`time sig ${before.timeSignature[0]}/${before.timeSignature[1]}→${after.timeSignature[0]}/${after.timeSignature[1]}`);
  if (parts.length === 0) parts.push("no changes");

  const summary = parts.join(", ");
  const unifiedDiff = buildUnifiedDiff(before, after, summary);

  return { summary, changes, unifiedDiff, tempoChanged, timeSigChanged };
}

// ─── Unified diff renderer ───────────────────────────────────────────────────

function buildUnifiedDiff(before: MidiClip, after: MidiClip, summary: string): string {
  const beforeAbc = abcCodec.encode(before, "before");
  const afterAbc  = abcCodec.encode(after,  "after");

  const beforeLines = beforeAbc.split("\n");
  const afterLines  = afterAbc.split("\n");

  // Standard unified-diff header
  const lines: string[] = [
    `--- before`,
    `+++ after`,
    `# ${summary}`,
  ];

  // Simple line-level diff (sufficient for the ABC body which is already bar-structured)
  const aLen = beforeLines.length, bLen = afterLines.length;
  const dp: number[][] = Array.from({ length: aLen + 1 }, () => new Array<number>(bLen + 1).fill(0));
  for (let i = 1; i <= aLen; i++)
    for (let j = 1; j <= bLen; j++)
      dp[i]![j] = beforeLines[i - 1] === afterLines[j - 1]
        ? dp[i - 1]![j - 1]! + 1
        : Math.max(dp[i - 1]![j]!, dp[i]![j - 1]!);

  // Collect diff hunks
  const ops: Array<{ op: "=" | "-" | "+"; line: string }> = [];
  let i = aLen, j = bLen;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && beforeLines[i - 1] === afterLines[j - 1]) {
      ops.unshift({ op: "=", line: beforeLines[i - 1]! });
      i--; j--;
    } else if (j > 0 && (i === 0 || dp[i]![j - 1]! >= dp[i - 1]![j]!)) {
      ops.unshift({ op: "+", line: afterLines[j - 1]! });
      j--;
    } else {
      ops.unshift({ op: "-", line: beforeLines[i - 1]! });
      i--;
    }
  }

  // Emit with 2-line context around changes
  const CONTEXT = 2;
  const changed = ops.map((o, idx) => o.op !== "=" ? idx : -1).filter(x => x >= 0);
  if (changed.length === 0) {
    lines.push("(no textual changes)");
    return lines.join("\n");
  }

  // Build context windows
  const toShow = new Set<number>();
  for (const idx of changed) {
    for (let k = Math.max(0, idx - CONTEXT); k <= Math.min(ops.length - 1, idx + CONTEXT); k++) {
      toShow.add(k);
    }
  }

  let prev = -2;
  for (const idx of [...toShow].sort((a, b) => a - b)) {
    if (idx > prev + 1) lines.push("@@");
    const { op, line } = ops[idx]!;
    lines.push((op === "=" ? " " : op) + line);
    prev = idx;
  }

  return lines.join("\n");
}
