export interface SessionState {
  tempo: number
  timeSignature: [number, number]
  currentClip: string | null
  bridgePort: number | null
}

export interface CoHarmoNative {
  startMidiDrag(path: string): void
  getSession(): Promise<SessionState>
}

declare global {
  interface Window {
    coharmo?: CoHarmoNative
  }
}
