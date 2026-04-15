// WS protocol types matching LocalBridgeServer (task #5)

export interface WsRequest {
  id: string
  method: string
  params?: Record<string, unknown>
}

export interface WsResponse {
  id: string
  result?: unknown
  error?: { code: number; message: string }
}

export interface SessionResult {
  sessionId: string
  sampleRate: number
  bpm: number
  timeSignature: [number, number]
  ppq: number
  hasClip: boolean
  clipLengthBars: number
}

export interface MidiEvent {
  tickOn: number
  tickOff: number
  pitch: number
  vel: number
  channel: number
}

export interface ClipResult {
  sessionId: string
  ppq: number
  events: MidiEvent[]
  tempo: number
  timeSignature: [number, number]
}

// Native interface injected by the JUCE WebBrowserComponent
export interface CoHarmoNative {
  startMidiDrag(path: string): void
  getSession(): Promise<SessionResult>
  wsEndpoint?: string
}

declare global {
  interface Window {
    coharmo?: CoHarmoNative
  }
}

export type BridgeStatus = 'connected' | 'disconnected' | 'capturing'

type StatusCallback = (status: BridgeStatus) => void

function resolveEndpoint(): string | null {
  if (import.meta.env.VITE_MOCK === '1') return null
  return window.coharmo?.wsEndpoint ?? null
}

export class CoHarmoBridge {
  private ws: WebSocket | null = null
  private pendingRequests = new Map<string, (res: WsResponse) => void>()
  private statusCallbacks: StatusCallback[] = []
  private status: BridgeStatus = 'disconnected'
  private reqCounter = 0
  private endpoint: string | null

  constructor() {
    this.endpoint = resolveEndpoint()
  }

  onStatus(cb: StatusCallback): () => void {
    this.statusCallbacks.push(cb)
    cb(this.status)
    return () => {
      this.statusCallbacks = this.statusCallbacks.filter(f => f !== cb)
    }
  }

  private setStatus(s: BridgeStatus) {
    if (this.status === s) return
    this.status = s
    this.statusCallbacks.forEach(cb => cb(s))
  }

  connect(token: string) {
    if (!this.endpoint) return
    this.ws = new WebSocket(this.endpoint)

    this.ws.onopen = () => {
      this.send({ id: this.nextId(), method: 'hello', params: { token } })
      this.setStatus('connected')
    }

    this.ws.onmessage = (ev: MessageEvent) => {
      let res: WsResponse
      try { res = JSON.parse(ev.data as string) as WsResponse } catch { return }
      const resolve = this.pendingRequests.get(res.id)
      if (resolve) {
        this.pendingRequests.delete(res.id)
        resolve(res)
      }
    }

    this.ws.onclose = () => {
      this.setStatus('disconnected')
      this.pendingRequests.forEach(r => r({ id: '', error: { code: -1, message: 'disconnected' } }))
      this.pendingRequests.clear()
    }

    this.ws.onerror = () => this.setStatus('disconnected')
  }

  disconnect() {
    this.ws?.close()
    this.ws = null
  }

  private nextId() {
    return String(++this.reqCounter)
  }

  private send(req: WsRequest) {
    this.ws?.send(JSON.stringify(req))
  }

  private call<T>(method: string, params?: Record<string, unknown>): Promise<T> {
    return new Promise((resolve, reject) => {
      const id = this.nextId()
      this.pendingRequests.set(id, (res) => {
        if (res.error) reject(new Error(res.error.message))
        else resolve(res.result as T)
      })
      this.send({ id, method, params })
    })
  }

  async getSession(): Promise<SessionResult> {
    if (!this.ws || this.status === 'disconnected') {
      return MOCK_SESSION
    }
    return this.call<SessionResult>('get_session')
  }

  async readClip(): Promise<ClipResult> {
    if (!this.ws || this.status === 'disconnected') {
      return MOCK_CLIP
    }
    return this.call<ClipResult>('read_clip')
  }
}

// Mock data used when VITE_MOCK=1 or native bridge is unavailable
export const MOCK_SESSION: SessionResult = {
  sessionId: 'mock-session-0000',
  sampleRate: 44100,
  bpm: 120,
  timeSignature: [4, 4],
  ppq: 480,
  hasClip: true,
  clipLengthBars: 4,
}

export const MOCK_CLIP: ClipResult = {
  sessionId: 'mock-session-0000',
  ppq: 480,
  tempo: 120,
  timeSignature: [4, 4],
  events: [
    { tickOn: 0,    tickOff: 480,  pitch: 60, vel: 80, channel: 0 },
    { tickOn: 480,  tickOff: 960,  pitch: 62, vel: 75, channel: 0 },
    { tickOn: 960,  tickOff: 1440, pitch: 64, vel: 82, channel: 0 },
    { tickOn: 1440, tickOff: 1920, pitch: 65, vel: 78, channel: 0 },
  ],
}
