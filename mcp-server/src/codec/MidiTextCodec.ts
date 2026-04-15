export interface MidiEvent {
  tick: number;
  type: "noteOn" | "noteOff" | "cc" | "programChange";
  channel: number;
  note?: number;
  velocity?: number;
  controller?: number;
  value?: number;
  program?: number;
}

export interface MidiClip {
  ppq: number;
  temposBpm: number[];
  timeSignatures: Array<{ numerator: number; denominator: number }>;
  events: MidiEvent[];
}

/** Codec interface — implementations live in M2+ (abcCodec.ts etc.) */
export interface MidiTextCodec {
  encode(clip: MidiClip): string;
  decode(text: string): MidiClip;
}
