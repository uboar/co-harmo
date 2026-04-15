import { useCallback, useEffect, useRef, useState } from 'react'
import {
  BridgeStatus,
  ClipResult,
  CoHarmoBridge,
  MidiEvent,
  MOCK_CLIP,
  MOCK_SESSION,
  SessionResult,
} from '../bridge'
import './App.css'

const isMock = import.meta.env.VITE_MOCK === '1'

const bridge = new CoHarmoBridge()

function pitchName(midi: number): string {
  const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
  return `${names[midi % 12]}${Math.floor(midi / 12) - 1}`
}

export default function App() {
  const [status, setStatus] = useState<BridgeStatus>('disconnected')
  const [session, setSession] = useState<SessionResult | null>(isMock ? MOCK_SESSION : null)
  const [clip, setClip] = useState<ClipResult | null>(isMock ? MOCK_CLIP : null)
  const [loading, setLoading] = useState(false)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const s = await bridge.getSession()
      setSession(s)
      if (s.hasClip) {
        const c = await bridge.readClip()
        setClip(c)
      }
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const unsub = bridge.onStatus((s) => {
      setStatus(s)
      if (s === 'connected') refresh()
    })

    if (isMock) {
      setStatus('connected')
    }

    pollRef.current = setInterval(() => {
      if (status === 'connected' || isMock) refresh()
    }, 2000)

    return () => {
      unsub()
      if (pollRef.current) clearInterval(pollRef.current)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const previewEvents = clip?.events.slice(0, 8) ?? []

  return (
    <div className="app">
      <header className="header">
        <h1 className="title">co-harmo</h1>
        <span className={`status-pill ${status}`}>{status}</span>
      </header>

      {session && (
        <div className="card">
          <div className="card-row">
            <span className="label">Session</span>
            <span className="value mono">{session.sessionId.slice(0, 16)}&hellip;</span>
          </div>
          <div className="card-row">
            <span className="label">BPM</span>
            <span className="value">{session.bpm}</span>
          </div>
          <div className="card-row">
            <span className="label">Time</span>
            <span className="value">{session.timeSignature[0]}/{session.timeSignature[1]}</span>
          </div>
          <div className="card-row">
            <span className="label">Captured</span>
            <span className="value">
              {session.hasClip ? `${session.clipLengthBars} bars` : 'no clip'}
            </span>
          </div>
          {clip && (
            <div className="card-row">
              <span className="label">Events</span>
              <span className="value">{clip.events.length}</span>
            </div>
          )}
        </div>
      )}

      {previewEvents.length > 0 && (
        <div className="card events-card">
          <div className="events-header">First {previewEvents.length} events</div>
          <table className="events-table">
            <thead>
              <tr><th>tick</th><th>note</th><th>vel</th><th>ch</th></tr>
            </thead>
            <tbody>
              {previewEvents.map((e: MidiEvent, i: number) => (
                <tr key={i}>
                  <td className="mono">{e.tickOn}</td>
                  <td className="mono">{pitchName(e.pitch)}</td>
                  <td>{e.vel}</td>
                  <td>{e.channel}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <button className="refresh-btn" onClick={refresh} disabled={loading}>
        {loading ? 'Loading…' : 'Refresh'}
      </button>
    </div>
  )
}
