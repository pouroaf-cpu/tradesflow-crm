'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useRouter, useParams, useSearchParams } from 'next/navigation'
import type { Contact } from '@/lib/sheets'
import AraCockpit, {
  type CallerIntel,
  type ClaudeFeedMessage,
  type TranscriptLine,
  type Objection,
} from '@/components/AraCockpit'

const WS_URL = 'ws://localhost:5000'
const RECONNECT_DELAY = 3000

const STAGES = ['Uncalled', 'Contacted', 'Interested', 'Follow-up Booked', 'Closed', 'Not Interested']
const OUTCOMES = ['No Answer', 'Left Voicemail', 'Not Interested', 'Call Back', 'Interested', 'Closed']

const STAGE_COLORS: Record<string, { bg: string; color: string }> = {
  'Uncalled':          { bg: '#E2E8F0', color: '#475569' },
  'Contacted':         { bg: '#DBEAFE', color: '#1D4ED8' },
  'Interested':        { bg: '#FEF3C7', color: '#92400E' },
  'Follow-up Booked':  { bg: '#EDE9FE', color: '#5B21B6' },
  'Closed':            { bg: '#DCFCE7', color: '#15803D' },
  'Not Interested':    { bg: '#FEE2E2', color: '#B91C1C' },
}

function formatNotes(raw: string): { text: string; ts: string }[] {
  if (!raw) return []
  const entries = raw.split(/(?=\[\d{4}-\d{2}-\d{2})/)
  return entries
    .map(e => e.trim())
    .filter(Boolean)
    .reverse()
    .map(e => {
      const match = e.match(/^\[([\s\S]+?)\]\s*([\s\S]*)$/)
      if (match) return { ts: match[1], text: match[2].trim() }
      return { ts: '', text: e }
    })
}

function initials(name: string) {
  return name.split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase()
}

function normaliseStage(s: string) {
  if (!s || s === 'Cold') return 'Uncalled'
  return s
}

export default function ContactPage() {
  const params = useParams()
  const searchParams = useSearchParams()
  const router = useRouter()
  const rowIndex = Number(params.id)

  const [contact, setContact] = useState<Contact | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const [stage, setStage] = useState('')
  const [outcome, setOutcome] = useState('')
  const [nextActionDate, setNextActionDate] = useState('')
  const [newNote, setNewNote] = useState('')

  // WS debug state
  const [wsStatus, setWsStatus] = useState<'connecting' | 'connected' | 'disconnected'>('connecting')
  const [lastWsMsg, setLastWsMsg] = useState('')

  // Cockpit state
  const [cockpitOpen, setCockpitOpen] = useState(false)
  const [isLive, setIsLive] = useState(false)
  const [claudeFeed, setClaudeFeed] = useState<ClaudeFeedMessage[]>([])
  const [transcript, setTranscript] = useState<TranscriptLine[]>([])
  const [mood, setMood] = useState('Neutral')
  const [heat, setHeat] = useState(5)
  const [instinct, setInstinct] = useState('Waiting for the call…')
  const [objection, setObjection] = useState<Objection>(null)

  const wsRef = useRef<WebSocket | null>(null)
  const reconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const queueParam = searchParams.get('queue')
  const queue = queueParam ? queueParam.split(',').map(Number) : []
  const currentIndex = queue.indexOf(rowIndex)
  const nextInQueue = currentIndex >= 0 && currentIndex < queue.length - 1 ? queue[currentIndex + 1] : null
  const prevInQueue = currentIndex > 0 ? queue[currentIndex - 1] : null

  const fetchContact = useCallback(async () => {
    const res = await fetch('/api/contacts')
    if (res.status === 401) { router.push('/login'); return }
    const data = await res.json()
    const found = data.contacts?.find((c: Contact) => c.rowIndex === rowIndex)
    if (!found) { router.push('/dashboard'); return }
    setContact(found)
    setStage(normaliseStage(found.pipelineStage))
    setOutcome(found.callOutcome || '')
    setNextActionDate(found.nextActionDate || '')
    setLoading(false)
  }, [rowIndex, router])

  useEffect(() => { fetchContact() }, [fetchContact])

  useEffect(() => {
    if (queueParam && queue.length > 0) {
      localStorage.setItem('tf_queue', queueParam)
      localStorage.setItem('tf_queue_current', String(rowIndex))
    }
  }, [queueParam, rowIndex])

  // WebSocket for cockpit
  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return
    const ws = new WebSocket(WS_URL)
    wsRef.current = ws

    ws.onopen = () => setWsStatus('connected')

    ws.onmessage = (e) => {
      let msg: Record<string, unknown>
      try { msg = JSON.parse(e.data) } catch { return }

      setLastWsMsg(`${String(msg.type)} @ ${new Date().toLocaleTimeString('en-NZ')}`)

      switch (msg.type) {
        case 'call_started':
          setClaudeFeed([])
          setTranscript([])
          setMood('Neutral')
          setHeat(5)
          setInstinct('Call connected…')
          setObjection(null)
          setIsLive(true)
          setCockpitOpen(true)
          break
        case 'transcript':
          setTranscript(prev => [...prev, msg.line as TranscriptLine])
          break
        case 'claude_feed':
          setClaudeFeed(prev => [msg.message as ClaudeFeedMessage, ...prev])
          break
        case 'radar_update':
          setMood(String(msg.mood ?? 'Neutral'))
          setHeat(Number(msg.heat ?? 5))
          setInstinct(String(msg.instinct ?? ''))
          break
        case 'objection':
          setObjection({ text: String(msg.text ?? ''), response: String(msg.response ?? '') })
          break
        case 'call_ended':
          setIsLive(false)
          break
      }
    }

    ws.onclose = () => {
      setWsStatus('disconnected')
      reconnectRef.current = setTimeout(connect, RECONNECT_DELAY)
    }
  }, [])

  useEffect(() => {
    connect()
    return () => {
      reconnectRef.current && clearTimeout(reconnectRef.current)
      wsRef.current?.close()
    }
  }, [connect])

  async function saveAndNext(overrideNote?: string) {
    if (!contact) return
    setSaving(true)
    const noteText = overrideNote !== undefined ? overrideNote : newNote
    const today = new Date().toISOString().slice(0, 10)
    const timestamp = new Date().toLocaleString('en-NZ', {
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit'
    })
    let updatedNotes = contact.notes || ''
    if (noteText.trim()) {
      const noteEntry = `[${timestamp}] ${noteText.trim()}`
      updatedNotes = updatedNotes ? `${updatedNotes}\n${noteEntry}` : noteEntry
    }
    const attempts = String((parseInt(contact.attempts || '0') || 0) + 1)
    await fetch('/api/contact', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rowIndex, pipelineStage: stage, callOutcome: outcome, lastCall: today, nextActionDate, attempts, notes: updatedNotes }),
    })
    setSaving(false)
    if (nextInQueue) {
      router.push(`/contact/${nextInQueue}?queue=${queueParam}`)
    } else {
      localStorage.removeItem('tf_queue')
      localStorage.removeItem('tf_queue_current')
      router.push('/dashboard')
    }
  }

  async function saveOnly(overrideNote?: string) {
    if (!contact) return
    setSaving(true)
    const noteText = overrideNote !== undefined ? overrideNote : newNote
    const today = new Date().toISOString().slice(0, 10)
    const timestamp = new Date().toLocaleString('en-NZ', {
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit'
    })
    let updatedNotes = contact.notes || ''
    if (noteText.trim()) {
      const noteEntry = `[${timestamp}] ${noteText.trim()}`
      updatedNotes = updatedNotes ? `${updatedNotes}\n${noteEntry}` : noteEntry
    }
    await fetch('/api/contact', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rowIndex, pipelineStage: stage, callOutcome: outcome, lastCall: today, nextActionDate, notes: updatedNotes }),
    })
    setNewNote('')
    setSaving(false)
    fetchContact()
  }

  const handleCockpitSaveAndNext = (notes: string) => {
    setCockpitOpen(false)
    void saveAndNext(notes)
  }

  const handleCockpitSaveOnly = (notes: string) => {
    void saveOnly(notes)
  }

  const handleEndCall = () => {
    wsRef.current?.send(JSON.stringify({ type: 'manual_end' }))
    setIsLive(false)
  }

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', color: 'var(--muted)' }}>
      Loading...
    </div>
  )

  if (!contact) return null

  const primaryNumber = (contact.mobile?.trim() && contact.mobile.trim() !== '0' && contact.mobile.trim() !== '')
    ? contact.mobile.trim()
    : contact.phone?.trim() || null

  const altNumber = (contact.mobile?.trim() && contact.phone?.trim() && contact.mobile.trim() !== contact.phone.trim())
    ? contact.phone.trim()
    : null

  const notes = formatNotes(contact.notes)
  const displayStage = normaliseStage(contact.pipelineStage)
  const stageStyle = STAGE_COLORS[displayStage] || { bg: '#E2E8F0', color: '#475569' }

  const callerIntel: CallerIntel = {
    rowNumber: contact.rowIndex,
    name: contact.name,
    tradeType: contact.tradeType,
    phone: contact.phone,
    region: contact.region,
    attempts: parseInt(contact.attempts || '0', 10),
    lastCall: contact.lastCall || '—',
  }

  return (
    <div style={{ display: 'grid', gridTemplateRows: 'auto 1fr', minHeight: '100vh', background: 'var(--bg)' }}>

      {/* Top nav */}
      <div style={{
        background: 'var(--surface)',
        borderBottom: '1px solid var(--border)',
        padding: '0 1.25rem',
        height: 48,
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        position: 'sticky',
        top: 0,
        zIndex: 10,
      }}>
        <button className="btn-ghost" onClick={() => router.push('/dashboard')} style={{ padding: '4px 10px', fontSize: 13 }}>
          ← Back
        </button>
        {queue.length > 0 && (
          <span style={{ fontSize: 12, color: 'var(--muted)' }}>
            {currentIndex + 1} / {queue.length}
          </span>
        )}
        <div style={{ flex: 1 }} />
        {prevInQueue && (
          <button className="btn-ghost" onClick={() => router.push(`/contact/${prevInQueue}?queue=${queueParam}`)} style={{ fontSize: 12, padding: '4px 10px' }}>
            ← Prev
          </button>
        )}
        {nextInQueue && (
          <button className="btn-ghost" onClick={() => router.push(`/contact/${nextInQueue}?queue=${queueParam}`)} style={{ fontSize: 12, padding: '4px 10px' }}>
            Next →
          </button>
        )}
      </div>

      {/* Two-column layout */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: '300px 1fr',
        height: 'calc(100vh - 48px)',
        overflow: 'hidden',
      }}>

        {/* ── SIDEBAR ── */}
        <div style={{
          background: 'var(--surface)',
          borderRight: '1px solid var(--border)',
          padding: '28px 20px',
          display: 'flex',
          flexDirection: 'column',
          gap: 28,
          overflowY: 'auto',
        }}>

          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <div style={{
              width: 48, height: 48, borderRadius: '50%',
              background: '#DBEAFE', color: '#1D4ED8',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontWeight: 600, fontSize: 15, flexShrink: 0,
            }}>
              {initials(contact.name)}
            </div>
            <div>
              <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--text)', marginBottom: 3 }}>{contact.name}</div>
              <div style={{ fontSize: 13, color: 'var(--muted)' }}>{contact.tradeType || '—'}</div>
            </div>
          </div>

          {primaryNumber && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <a
                href={`tel:${primaryNumber.replace(/\s/g, '')}`}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
                  padding: '12px 16px', borderRadius: 8,
                  background: '#16a34a', color: '#fff',
                  textDecoration: 'none', fontSize: 15, fontWeight: 700,
                  letterSpacing: '0.02em',
                }}
              >
                <span style={{ fontSize: 16 }}>📞</span>
                {primaryNumber}
              </a>
              {altNumber && (
                <a
                  href={`tel:${altNumber.replace(/\s/g, '')}`}
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
                    padding: '11px 16px', borderRadius: 8,
                    background: '#15803d', color: '#fff',
                    textDecoration: 'none', fontSize: 13, fontWeight: 500,
                    opacity: 0.85,
                  }}
                >
                  <span style={{ fontSize: 14 }}>📞</span>
                  {altNumber}
                </a>
              )}
            </div>
          )}

          <div>
            <div style={sectionLabel}>Status</div>
            <span style={{
              display: 'inline-block',
              fontSize: 12, fontWeight: 600,
              padding: '4px 12px', borderRadius: 20,
              background: stageStyle.bg, color: stageStyle.color,
            }}>
              {displayStage}
            </span>
          </div>

          <div>
            <div style={sectionLabel}>Contact</div>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              {[
                ['Mobile', contact.mobile?.trim() || '—'],
                ['Phone', contact.phone?.trim() || '—'],
                ['Region', contact.region || '—'],
                ['Decision maker', contact.decisionMaker || '—'],
                ['Attempts', contact.attempts && contact.attempts !== '0' ? contact.attempts : '0'],
                ['Last called', contact.lastCall || 'Never'],
              ].map(([label, value]) => (
                <div key={label} style={fieldRow}>
                  <span style={{ color: 'var(--muted)', fontSize: 13 }}>{label}</span>
                  <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)' }}>{value}</span>
                </div>
              ))}
            </div>
          </div>

          {notes.length > 0 && (
            <div>
              <div style={sectionLabel}>Call history</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {notes.map((n, i) => (
                  <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                    <div style={{
                      width: 7, height: 7, borderRadius: '50%',
                      background: 'var(--border)', marginTop: 5, flexShrink: 0,
                    }} />
                    <div>
                      {n.ts && <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 2 }}>{n.ts}</div>}
                      <div style={{ fontSize: 13, lineHeight: 1.5, color: 'var(--text)' }}>{n.text}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* ── MAIN ── */}
        <div style={{
          padding: '32px 40px',
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
          gap: 20,
        }}>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <div style={{ fontSize: 22, fontWeight: 600, color: 'var(--text)', marginBottom: 4 }}>Log this call</div>
              <div style={{ fontSize: 14, color: 'var(--muted)' }}>
                {contact.name} · {new Date().toLocaleDateString('en-NZ', { day: 'numeric', month: 'short', year: 'numeric' })}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
              <button className="btn-ghost" onClick={() => saveOnly()} disabled={saving} style={{ fontSize: 13 }}>
                Save only
              </button>
              {queue.length > 0 && nextInQueue ? (
                <button className="btn-primary" onClick={() => saveAndNext()} disabled={saving}>
                  {saving ? 'Saving...' : 'Save & next →'}
                </button>
              ) : (
                <button className="btn-primary" onClick={() => saveOnly()} disabled={saving}>
                  {saving ? 'Saving...' : 'Save & close'}
                </button>
              )}
            </div>
          </div>

          <div style={card}>
            <div style={sectionLabel}>Outcome</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
              {OUTCOMES.map(o => (
                <button
                  key={o}
                  onClick={() => setOutcome(o)}
                  style={{
                    padding: '10px 8px',
                    borderRadius: 8,
                    border: `1px solid ${outcome === o ? 'var(--accent)' : 'var(--border)'}`,
                    background: outcome === o ? 'var(--accent-dim)' : 'var(--bg)',
                    color: outcome === o ? 'var(--accent)' : 'var(--muted)',
                    fontWeight: outcome === o ? 600 : 400,
                    fontSize: 13,
                    cursor: 'pointer',
                    textAlign: 'center',
                    transition: 'all 0.12s',
                  }}
                >
                  {o}
                </button>
              ))}
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <div style={card}>
              <div style={sectionLabel}>Pipeline stage</div>
              <select value={stage} onChange={e => setStage(e.target.value)} style={{ width: '100%' }}>
                {STAGES.map(s => <option key={s}>{s}</option>)}
              </select>
            </div>
            <div style={card}>
              <div style={sectionLabel}>Next action date</div>
              <input type="date" value={nextActionDate} onChange={e => setNextActionDate(e.target.value)} style={{ width: '100%' }} />
            </div>
          </div>

          <div style={card}>
            <div style={sectionLabel}>Notes from this call</div>
            <textarea
              value={newNote}
              onChange={e => setNewNote(e.target.value)}
              placeholder="What happened? Any objections, commitments, or follow-up context..."
              rows={4}
              style={{ resize: 'vertical', width: '100%' }}
            />
          </div>

        </div>
      </div>

      {/* WS debug bar */}
      <div style={{
        position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 999,
        background: '#0a0a0a', borderTop: '1px solid #222',
        padding: '3px 12px', display: 'flex', gap: 20, alignItems: 'center',
        fontFamily: 'monospace', fontSize: 11,
      }}>
        <span style={{ color: wsStatus === 'connected' ? '#4ade80' : wsStatus === 'connecting' ? '#fbbf24' : '#f87171' }}>
          ● WS {wsStatus}
        </span>
        {lastWsMsg && <span style={{ color: '#666' }}>last: {lastWsMsg}</span>}
      </div>

      {/* Cockpit slide-in overlay */}
      <AraCockpit
        isOpen={cockpitOpen}
        isLive={isLive}
        callerIntel={callerIntel}
        claudeFeed={claudeFeed}
        transcript={transcript}
        mood={mood}
        heat={heat}
        instinct={instinct}
        objection={objection}
        onSaveAndNext={handleCockpitSaveAndNext}
        onSaveOnly={handleCockpitSaveOnly}
        onEndCall={handleEndCall}
      />

      <style>{`
        @media (max-width: 768px) {
          div[style*="gridTemplateColumns: 300px"] {
            grid-template-columns: 1fr !important;
            height: auto !important;
            overflow: visible !important;
          }
          div[style*="gridTemplateColumns: 300px"] > div:first-child {
            border-right: none !important;
            border-bottom: 1px solid var(--border);
            height: auto !important;
            overflow: visible !important;
          }
          div[style*="gridTemplateColumns: 300px"] > div:last-child {
            padding: 20px 16px !important;
          }
          div[style*="gridTemplateColumns: repeat(3"] {
            grid-template-columns: repeat(2, 1fr) !important;
          }
          div[style*="gridTemplateColumns: 1fr 1fr"] {
            grid-template-columns: 1fr !important;
          }
        }
      `}</style>
    </div>
  )
}

const sectionLabel: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  color: 'var(--muted)',
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
  marginBottom: 10,
}

const fieldRow: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  padding: '8px 0',
  borderBottom: '1px solid var(--border)',
}

const card: React.CSSProperties = {
  background: 'var(--surface)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius)',
  padding: '16px 20px',
}
