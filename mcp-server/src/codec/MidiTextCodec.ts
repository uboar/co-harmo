/** A single note event, as returned by the plugin's read_clip WS method. */
export interface NoteEvent {
  tickOn: number;
  tickOff: number;
  pitch: number;
  vel: number;
  channel: number;
}

/** A CC event, derived from plugin events or injected for ABC encoding. */
export interface CcEvent {
  tick: number;
  controller: number;
  value: number;
}

/** A program-change event. */
export interface ProgramChangeEvent {
  tick: number;
  channel: number;
  program: number;
}

export interface MidiClip {
  ppq: number;
  tempo: number;
  timeSignature: [number, number];
  events: NoteEvent[];
  ccEvents?: CcEvent[];
  programChanges?: ProgramChangeEvent[];
}

/** Codec interface — encode/decode between MidiClip and a text format. */
export interface MidiTextCodec {
  encode(clip: MidiClip, name?: string): string;
  decode(text: string): MidiClip;
}
