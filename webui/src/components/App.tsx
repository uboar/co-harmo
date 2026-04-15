import { useCallback, useEffect, useRef, useState } from 'react'
import {
  BridgeStatus,
  ClipResult,
  CoHarmoBridge,
  MidiEvent,
  MOCK_CLIP,
  MOCK_PENDING,
  MOCK_SESSION,
  PendingClip,
  SessionResult,
} from '../bridge'
import './App.css'

const isMock = import.meta.env.VITE_MOCK === '1'

const bridge = new CoHarmoBridge()

function pitchName(midi: number): string {
  const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
  return `${names[midi % 12]}${Math.floor(midi / 12) - 1}`
}

function relativeTime(iso: string): string {
  const diff = Math.round((Date.now() - new Date(iso).getTime()) / 1000)
  if (diff < 60) return `${diff}s ago`
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  return `${Math.floor(diff / 3600)}h ago`
}

export default function App() {
  const [status, setStatus] = useState<BridgeStatus>('disconnected')
  const [session, setSession] = useState<SessionResult | null>(isMock ? MOCK_SESSION : null)
  const [clip, setClip] = useState<ClipResult | null>(isMock ? MOCK_CLIP : null)
  const [pending, setPending] = useState<PendingClip[]>(isMock ? MOCK_PENDING : [])
  const [loading, setLoading] = useState(false)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const [s, p] = await Promise.all([bridge.getSession(), bridge.listPending()])
      setSession(s)
      setPending(p)
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

    if (isMock) setStatus('connected')

    pollRef.current = setInterval(() => {
      if (status === 'connected' || isMock) refresh()
    }, 2000)

    return () => {
      unsub()
      if (pollRef.current) clearInterval(pollRef.current)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleAccept = async (token: string) => {
    await bridge.acceptPending(token)
    setPending(p => p.filter(c => c.undoToken !== token))
  }

  const handleRevert = async (token: string) => {
    await bridge.revertPending(token)
    setPending(p => p.filter(c => c.undoToken !== token))
  }

  const statusLabel = pending.length > 0
    ? `pending: ${pending.length}`
    : status

  const previewEvents = clip?.events.slice(0, 8) ?? []

  return (
    <div className="app">
      <header className="header">
        <h1 className="title">co-harmo</h1>
        <span className={`status-pill ${pending.length > 0 ? 'has-pending' : status}`} aria-label={`Status: ${statusLabel}`}>
          {statusLabel}
        </span>
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

      {pending.length > 0 && (
        <div className="card pending-card">
          <div className="section-title">Pending Clips</div>
          {pending.map((p) => (
            <div key={p.undoToken} className="pending-row">
              <div className="pending-info">
                <span className="mono pending-token">{p.undoToken.slice(0, 14)}</span>
                <span className="pending-meta">{p.eventCount} events &middot; {relativeTime(p.createdAt)}</span>
              </div>
              <div className="pending-actions">
                <button
                  className="icon-btn drag-btn"
                  title="Drag to DAW track"
                  aria-label="Drag clip to DAW track"
                  onClick={() => bridge.startMidiDrag(p.undoToken)}
                >
                  &#8645;
                </button>
                <button
                  className="icon-btn accept-btn"
                  aria-label={`Accept clip ${p.undoToken}`}
                  onClick={() => handleAccept(p.undoToken)}
                >
                  &#10003;
                </button>
                <button
                  className="icon-btn revert-btn"
                  aria-label={`Revert clip ${p.undoToken}`}
                  onClick={() => handleRevert(p.undoToken)}
                >
                  &#10005;
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <button className="refresh-btn" onClick={refresh} disabled={loading} aria-label="Refresh session data">
        {loading ? 'Loading…' : 'Refresh'}
      </button>
    </div>
  )
}
