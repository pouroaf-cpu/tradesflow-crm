'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useRouter, useParams, useSearchParams } from 'next/navigation'
import type { Contact } from '@/lib/sheets'
import type {
  ClaudeFeedMessage,
  TranscriptLine,
  Objection,
} from '@/components/AraCockpit'

const WS_URL = 'ws://localhost:5000'
const RECONNECT_DELAY = 3000

const STAGES = ['Uncalled', 'Contacted', 'Interested', 'Follow-up Booked', 'Closed', 'Not Interested']

const moodColors: Record<string, { bg: string; text: string; bar: string }> = {
  Warm:       { bg: '#e8f5e9', text: '#2e7d32', bar: '#4caf50' },
  Neutral:    { bg: '#fff8e1', text: '#f57f17', bar: '#ffc107' },
  Guarded:    { bg: '#fff3e0', text: '#e65100', bar: '#ff9800' },
  Resistant:  { bg: '#fce4ec', text: '#b71c1c', bar: '#ef5350' },
  Interested: { bg: '#e3f2fd', text: '#0d47a1', bar: '#2196f3' },
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

function formatDuration(s: number) {
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

const sectionLabel: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 500,
  color: '#888',
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
  marginBottom: 6,
}

const fieldRow: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  padding: '6px 0',
  borderBottom: '0.5px solid #f0ede6',
  fontSize: 12,
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  fontSize: 13,
  border: '0.5px solid #e8e6df',
  borderRadius: 6,
  padding: '7px 10px',
  background: '#fafaf8',
  color: '#1a1a1a',
  boxSizing: 'border-box',
  fontFamily: 'inherit',
  outline: 'none',
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
  const [nextActionDate, setNextActionDate] = useState('')
  const [newNote, setNewNote] = useState('')

  // WS state
  const [wsStatus, setWsStatus] = useState<'connecting' | 'connected' | 'disconnected'>('connecting')
  const [lastWsMsg, setLastWsMsg] = useState('')

  // Cockpit state
  const [isLive, setIsLive] = useState(false)
  const [claudeFeed, setClaudeFeed] = useState<ClaudeFeedMessage[]>([])
  const [transcript, setTranscript] = useState<TranscriptLine[]>([])
  const [mood, setMood] = useState('Neutral')
  const [heat, setHeat] = useState(5)
  const [instinct, setInstinct] = useState('Waiting for the call…')
  const [objection, setObjection] = useState<Objection>(null)
  const [callDuration, setCallDuration] = useState(0)
  const [newMessageId, setNewMessageId] = useState<number | null>(null)
  const [prevFeedLength, setPrevFeedLength] = useState(0)
  const [detectedName, setDetectedName] = useState<string | null>(null)
  const [nameStatus, setNameStatus] = useState<'unconfirmed' | 'confirmed'>('unconfirmed')
  const [nameOverride, setNameOverride] = useState<string | null>(null)

  // Playbook state
  const [playbookOpener, setPlaybookOpener] = useState<string>('')
  const [playbookObjections, setPlaybookObjections] = useState<{title: string; content: string}[]>([])
  const [playbookCollapsed, setPlaybookCollapsed] = useState(false)
  const [openerState, setOpenerState] = useState<'idle' | 'active' | 'flashing' | 'done'>('idle')
  const [objectionFading, setObjectionFading] = useState(false)

  const wsRef = useRef<WebSocket | null>(null)
  const reconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const transcriptRef = useRef<HTMLDivElement>(null)
  const pouTranscriptRef = useRef<HTMLDivElement>(null)
  const nameCountRef = useRef<Record<string, number>>({})
  const confirmedNameRef = useRef<string | null>(null)
  const openerDoneRef = useRef(false)
  const objectionRef = useRef<Objection>(null)
  const objectionFadeRef = useRef<ReturnType<typeof setTimeout> | null>(null)

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

  // Call duration timer
  useEffect(() => {
    if (isLive) {
      timerRef.current = setInterval(() => setCallDuration(d => d + 1), 1000)
    } else {
      if (timerRef.current) clearInterval(timerRef.current)
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current) }
  }, [isLive])

  // New message highlight
  useEffect(() => {
    if (claudeFeed.length > prevFeedLength && claudeFeed[0]) {
      setNewMessageId(claudeFeed[0].id)
      setPrevFeedLength(claudeFeed.length)
      setTimeout(() => setNewMessageId(null), 1000)
    }
  }, [claudeFeed, prevFeedLength])

  // Auto-scroll transcript columns — newest at top so scroll to 0
  useEffect(() => {
    if (transcriptRef.current) transcriptRef.current.scrollTop = 0
    if (pouTranscriptRef.current) pouTranscriptRef.current.scrollTop = 0
  }, [transcript])

  // Load playbook on mount
  useEffect(() => {
    fetch('/api/playbook')
      .then(r => r.json())
      .then(data => {
        const items: {type: string; title: string; content: string}[] = data.items || []
        const opener = items.find(i => i.type === 'opener')
        setPlaybookOpener(opener?.content || '')
        setPlaybookObjections(items.filter(i => i.type === 'objection').map(i => ({ title: i.title, content: i.content })))
      })
      .catch(() => {})
  }, [])

  // Keep objectionRef in sync for use inside WS closure
  useEffect(() => { objectionRef.current = objection }, [objection])

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
          setCallDuration(0)
          setPrevFeedLength(0)
          setNewMessageId(null)
          setIsLive(true)
          nameCountRef.current = {}
          confirmedNameRef.current = null
          setDetectedName(null)
          setNameStatus('unconfirmed')
          setNameOverride(null)
          openerDoneRef.current = false
          setOpenerState('active')
          if (objectionFadeRef.current) clearTimeout(objectionFadeRef.current)
          setObjectionFading(false)
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
          if (objectionFadeRef.current) clearTimeout(objectionFadeRef.current)
          setObjectionFading(false)
          setObjection({ text: String(msg.text ?? ''), response: String(msg.response ?? '') })
          break
        case 'objection_cleared':
          if (objectionRef.current) {
            if (objectionFadeRef.current) clearTimeout(objectionFadeRef.current)
            setObjectionFading(true)
            objectionFadeRef.current = setTimeout(() => {
              setObjection(null)
              objectionRef.current = null
              setObjectionFading(false)
            }, 5000)
          }
          break
        case 'opener_status':
          if (msg.done && !openerDoneRef.current) {
            openerDoneRef.current = true
            setOpenerState('flashing')
            setTimeout(() => setOpenerState('done'), 1200)
          }
          break
        case 'name_detected': {
          const name = String(msg.name).trim()
          const counts = nameCountRef.current
          counts[name] = (counts[name] ?? 0) + 1
          const confirmed = confirmedNameRef.current
          if (confirmed) {
            if (name !== confirmed) setNameOverride(name)
          } else {
            setDetectedName(name)
            if (counts[name] >= 2) {
              confirmedNameRef.current = name
              setNameStatus('confirmed')
              fetch('/api/contact', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ rowIndex, nameDetected: name }),
              })
            } else {
              setNameStatus('unconfirmed')
            }
          }
          break
        }
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
      body: JSON.stringify({ rowIndex, pipelineStage: stage, lastCall: today, nextActionDate, attempts, notes: updatedNotes }),
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
      body: JSON.stringify({ rowIndex, pipelineStage: stage, lastCall: today, nextActionDate, notes: updatedNotes }),
    })
    setNewNote('')
    setSaving(false)
    fetchContact()
  }

  function applyNameOverride(name: string) {
    confirmedNameRef.current = name
    setDetectedName(name)
    setNameStatus('confirmed')
    setNameOverride(null)
    fetch('/api/contact', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rowIndex, nameDetected: name }),
    })
  }

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', color: '#888' }}>
      Loading...
    </div>
  )

  if (!contact) return null

  const primaryNumber = contact.phone?.trim() || null

  const notes = formatNotes(contact.notes)
  const moodStyle = moodColors[mood] || moodColors.Neutral

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: '#f5f4ef', overflow: 'hidden' }}>

      {/* TOP NAV */}
      <nav style={{
        background: '#fff',
        borderBottom: '0.5px solid #e8e6df',
        height: 44,
        display: 'flex',
        alignItems: 'center',
        padding: '0 16px',
        gap: 10,
        flexShrink: 0,
      }}>
        <button
          onClick={() => router.push('/dashboard')}
          style={{ fontSize: 13, color: '#888', border: '0.5px solid #e8e6df', borderRadius: 6, padding: '4px 10px', background: 'transparent', cursor: 'pointer' }}
        >
          ← Back
        </button>
        {queue.length > 0 && (
          <span style={{ fontSize: 12, color: '#888' }}>{currentIndex + 1} / {queue.length}</span>
        )}
        {prevInQueue && (
          <button
            onClick={() => router.push(`/contact/${prevInQueue}?queue=${queueParam}`)}
            style={{ fontSize: 12, color: '#888', border: '0.5px solid #e8e6df', borderRadius: 6, padding: '4px 10px', background: 'transparent', cursor: 'pointer' }}
          >
            ← Prev
          </button>
        )}
        {nextInQueue && (
          <button
            onClick={() => router.push(`/contact/${nextInQueue}?queue=${queueParam}`)}
            style={{ fontSize: 12, color: '#888', border: '0.5px solid #e8e6df', borderRadius: 6, padding: '4px 10px', background: 'transparent', cursor: 'pointer' }}
          >
            Next →
          </button>
        )}
        <div style={{ flex: 1 }} />
        {isLive && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, background: '#e8f5e9', border: '0.5px solid #a5d6a7', borderRadius: 20, padding: '3px 10px', fontSize: 11, fontWeight: 500, color: '#2e7d32' }}>
            <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#43a047', animation: 'pulse 1.5s infinite' }} />
            LIVE {formatDuration(callDuration)}
          </div>
        )}
        <button
          onClick={() => saveOnly()}
          disabled={saving}
          style={{ fontSize: 12, border: '0.5px solid #e8e6df', borderRadius: 6, padding: '5px 12px', background: '#fff', cursor: 'pointer', color: '#444' }}
        >
          Save only
        </button>
        <button
          onClick={() => nextInQueue ? saveAndNext() : saveOnly()}
          disabled={saving}
          style={{ fontSize: 12, border: 'none', borderRadius: 6, padding: '5px 14px', background: '#1a237e', color: '#fff', cursor: 'pointer', fontWeight: 500 }}
        >
          {saving ? 'Saving…' : nextInQueue ? 'Save & next →' : 'Save & close'}
        </button>
      </nav>

      {/* BODY */}
      <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '260px 1fr', overflow: 'hidden' }}>

        {/* LEFT COLUMN */}
        <div style={{
          background: '#fff',
          borderRight: '0.5px solid #e8e6df',
          padding: '18px 16px',
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
          overflowY: 'auto',
        }}>

          {/* Avatar + name */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{
              width: 42, height: 42, borderRadius: '50%',
              background: '#e8eaf6', color: '#1a237e',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontWeight: 500, fontSize: 14, flexShrink: 0,
            }}>
              {initials(contact.name)}
            </div>
            <div>
              <p style={{ fontSize: 15, fontWeight: 500, color: '#1a1a1a', margin: 0, marginBottom: 2 }}>{contact.name}</p>
              <p style={{ fontSize: 12, color: '#888', margin: 0 }}>
                {contact.tradeType || '—'}{contact.region ? ` · ${contact.region}` : ''}
              </p>
            </div>
          </div>

          {/* Phone button — primary number only */}
          <a
            href={primaryNumber ? `tel:${primaryNumber.replace(/\s/g, '')}` : undefined}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              padding: '10px 14px', borderRadius: 8,
              background: '#16a34a', color: '#fff',
              textDecoration: 'none', fontSize: 14, fontWeight: 500,
              opacity: primaryNumber ? 1 : 0.5,
              pointerEvents: primaryNumber ? 'auto' : 'none',
            }}
          >
            📞 {primaryNumber || 'No number'}
          </a>

          {/* Contact details */}
          <div>
            <div style={sectionLabel}>Contact</div>
            {[
              ['Mobile', contact.mobile?.trim() || '—'],
              ['Region', contact.region || '—'],
              ['Attempts', contact.attempts && contact.attempts !== '0' ? contact.attempts : '0'],
              ['Last called', contact.lastCall || 'Never'],
            ].map(([label, value]) => (
              <div key={label} style={fieldRow}>
                <span style={{ color: '#888' }}>{label}</span>
                <span style={{ fontWeight: 500, color: '#1a1a1a' }}>{value}</span>
              </div>
            ))}
          </div>

          {/* Detected name */}
          {detectedName && (
            <div>
              <div style={sectionLabel}>Detected name</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: nameOverride ? 6 : 0 }}>
                <span style={{ fontSize: 13, fontWeight: 500, color: '#1a1a1a' }}>{detectedName}</span>
                {nameStatus === 'confirmed' ? (
                  <span style={{ fontSize: 10, color: '#2e7d32', background: '#e8f5e9', border: '0.5px solid #a5d6a7', borderRadius: 10, padding: '1px 6px' }}>✓ Confirmed</span>
                ) : (
                  <span style={{ fontSize: 10, color: '#f57f17', background: '#fff8e1', border: '0.5px solid #ffe082', borderRadius: 10, padding: '1px 6px' }}>⚠ Unconfirmed</span>
                )}
              </div>
              {nameOverride && (
                <div style={{ background: '#fff8e1', border: '0.5px solid #ffe082', borderRadius: 6, padding: '8px 10px', fontSize: 11, marginTop: 6 }}>
                  <div style={{ color: '#e65100', marginBottom: 6 }}>⚠ New name heard: {nameOverride}</div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button onClick={() => setNameOverride(null)}
                      style={{ fontSize: 11, padding: '3px 8px', borderRadius: 4, border: '0.5px solid #ccc', background: '#fff', cursor: 'pointer' }}>
                      Keep {detectedName}
                    </button>
                    <button onClick={() => applyNameOverride(nameOverride)}
                      style={{ fontSize: 11, padding: '3px 8px', borderRadius: 4, border: 'none', background: '#1a237e', color: '#fff', cursor: 'pointer' }}>
                      Use {nameOverride}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Pipeline stage */}
          <div>
            <div style={sectionLabel}>Pipeline stage</div>
            <select
              value={stage}
              onChange={e => setStage(e.target.value)}
              style={{ ...inputStyle, appearance: 'none' as const }}
            >
              {STAGES.map(s => <option key={s}>{s}</option>)}
            </select>
          </div>

          {/* Next action date */}
          <div>
            <div style={sectionLabel}>Next action date</div>
            <input
              type="date"
              value={nextActionDate}
              onChange={e => setNextActionDate(e.target.value)}
              style={inputStyle}
            />
          </div>

          {/* Notes textarea — grows to fill available space */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 80 }}>
            <div style={sectionLabel}>Notes from this call</div>
            <textarea
              value={newNote}
              onChange={e => setNewNote(e.target.value)}
              placeholder="What happened? Any objections, commitments, or follow-up context..."
              style={{ ...inputStyle, flex: 1, resize: 'vertical', minHeight: 64 }}
            />
          </div>

          {/* Call history */}
          {notes.length > 0 && (
            <div>
              <div style={sectionLabel}>Call history</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {notes.map((n, i) => (
                  <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                    <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#d1cfc8', marginTop: 4, flexShrink: 0 }} />
                    <div>
                      {n.ts && <div style={{ fontSize: 10, color: '#aaa', marginBottom: 2 }}>{n.ts}</div>}
                      <div style={{ fontSize: 12, color: '#444', lineHeight: 1.4 }}>{n.text}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* RIGHT COLUMN */}
        <div style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

          {/* Radar bar */}
          <div style={{
            background: moodStyle.bg,
            borderBottom: `1px solid ${moodStyle.bar}22`,
            padding: '8px 16px',
            display: 'flex',
            alignItems: 'center',
            gap: 14,
            flexShrink: 0,
          }}>
            <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: 1, color: '#aaa', textTransform: 'uppercase' }}>Radar</span>
            <span style={{ background: moodStyle.bg, border: `1px solid ${moodStyle.bar}44`, borderRadius: 20, padding: '3px 12px', fontSize: 12, fontWeight: 500, color: moodStyle.text }}>
              {mood}
            </span>
            <div style={{ flex: 1, maxWidth: 140, height: 5, background: '#f0ede6', borderRadius: 3, overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${heat * 10}%`, background: moodStyle.bar, borderRadius: 3, transition: 'width 0.6s ease' }} />
            </div>
            <span style={{ fontSize: 11, fontWeight: 500, color: moodStyle.text }}>{heat}/10</span>
            <span style={{ fontSize: 12, color: '#555', fontStyle: 'italic' }}>&ldquo;{instinct}&rdquo;</span>
          </div>

          {/* Playbook Bar */}
          {!playbookCollapsed ? (
            <div style={{
              background: '#fff',
              borderBottom: '0.5px solid #e8e6df',
              flexShrink: 0,
              display: 'flex',
              minHeight: 56,
              maxHeight: 96,
              position: 'relative',
            }}>
              {/* Zone 1 — Opener */}
              <div style={{
                flex: 1,
                padding: '8px 12px',
                borderRight: '0.5px solid #e8e6df',
                display: 'flex',
                alignItems: 'center',
                overflowY: 'auto',
                ...(openerState === 'active' ? { animation: 'pulseGreenBorder 2s ease-in-out infinite' } : {}),
                ...(openerState === 'flashing' ? { background: '#4caf50' } : {}),
              }}>
                {openerState === 'flashing' ? (
                  <span style={{ fontSize: 15, fontWeight: 600, color: '#fff' }}>✓ Opener done!</span>
                ) : openerState === 'active' && playbookOpener ? (
                  <span style={{ fontSize: 13, color: '#1a1a1a', lineHeight: 1.45 }}>{playbookOpener}</span>
                ) : openerState === 'done' ? (
                  <span style={{ fontSize: 11, color: '#4caf50', fontStyle: 'italic' }}>✓ Opener complete</span>
                ) : (
                  <span style={{ fontSize: 11, color: '#ccc', fontStyle: 'italic' }}>Waiting for call…</span>
                )}
              </div>

              {/* Zone 2 — Active objection */}
              <div style={{
                flex: 1,
                padding: '8px 12px',
                paddingRight: 36,
                display: 'flex',
                alignItems: 'center',
                overflowY: 'auto',
              }}>
                {objection ? (() => {
                  const matched = playbookObjections.find(o =>
                    objection.text.toLowerCase().includes(o.title.toLowerCase()) ||
                    o.title.toLowerCase().includes(objection.text.toLowerCase())
                  )
                  const response = matched?.content ?? objection.response
                  return (
                    <div style={{
                      background: '#fff8e1',
                      border: '0.5px solid #ffe082',
                      borderRadius: 7,
                      padding: '6px 10px',
                      fontSize: 11,
                      width: '100%',
                      ...(objectionFading ? { opacity: 0, transition: 'opacity 5s ease' } : { opacity: 1 }),
                    }}>
                      <div style={{ fontWeight: 600, color: '#e65100', marginBottom: 2 }}>⚠ {objection.text}</div>
                      <div style={{ color: '#78350f', lineHeight: 1.4 }}>{response}</div>
                    </div>
                  )
                })() : (
                  <span style={{ fontSize: 11, color: '#ccc', fontStyle: 'italic' }}>No objection detected</span>
                )}
              </div>

              {/* Collapse chevron */}
              <button
                onClick={() => setPlaybookCollapsed(true)}
                style={{
                  position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)',
                  background: 'none', border: '0.5px solid #e8e6df', borderRadius: 4,
                  cursor: 'pointer', fontSize: 10, color: '#bbb', padding: '2px 6px', lineHeight: 1,
                }}
              >▾</button>
            </div>
          ) : (
            <div style={{
              background: '#fff', borderBottom: '0.5px solid #e8e6df',
              flexShrink: 0, display: 'flex', alignItems: 'center', padding: '4px 10px', gap: 6,
            }}>
              <span style={{ fontSize: 9, fontWeight: 600, color: '#bbb', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Playbook</span>
              <button
                onClick={() => setPlaybookCollapsed(false)}
                style={{ background: 'none', border: '0.5px solid #e8e6df', borderRadius: 4, cursor: 'pointer', fontSize: 10, color: '#bbb', padding: '1px 6px' }}
              >▸</button>
            </div>
          )}

          {/* Claude Feed + Live Transcript panels */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: 12,
            padding: 12,
            flex: 1,
            minHeight: 0,
            overflow: 'hidden',
          }}>

            {/* Claude Feed */}
            <div style={{ background: '#fff', border: '0.5px solid #e8e6df', borderRadius: 10, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
              <div style={{ padding: '10px 14px', borderBottom: '0.5px solid #f0ede6', display: 'flex', alignItems: 'center', gap: 7, flexShrink: 0 }}>
                <div style={{ width: 7, height: 7, borderRadius: '50%', background: '#4caf50', boxShadow: '0 0 0 2px #c8e6c9' }} />
                <span style={{ fontSize: 10, fontWeight: 500, color: '#aaa', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Claude feed</span>
              </div>
              <div style={{ flex: 1, padding: '10px 12px', overflowY: 'auto' }}>
                {claudeFeed.length === 0 && (
                  <div style={{ fontSize: 12, color: '#bbb', fontStyle: 'italic', padding: 8 }}>Waiting for the call to start…</div>
                )}
                {claudeFeed.map(msg => (
                  <div
                    key={msg.id}
                    style={{
                      background: msg.id === newMessageId ? '#e8f5e9' : '#fafaf8',
                      border: `0.5px solid ${msg.id === newMessageId ? '#a5d6a7' : '#f0ede6'}`,
                      borderRadius: 8,
                      padding: '8px 12px',
                      marginBottom: 7,
                      transition: 'background 0.5s, border 0.5s',
                      animation: msg.id === newMessageId ? 'slideIn 0.3s ease' : 'none',
                    }}
                  >
                    <div style={{ fontSize: 10, color: '#bbb', fontWeight: 500, marginBottom: 3 }}>{msg.time}</div>
                    <div style={{ fontSize: 12, color: '#333', lineHeight: 1.4 }}>{msg.text}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Live Transcript */}
            <div style={{ background: '#fff', border: '0.5px solid #e8e6df', borderRadius: 10, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
              <div style={{ padding: '10px 14px', borderBottom: '0.5px solid #f0ede6', display: 'flex', alignItems: 'center', gap: 7, flexShrink: 0 }}>
                <div style={{ width: 7, height: 7, borderRadius: '50%', background: '#2196f3', boxShadow: '0 0 0 2px #bbdefb' }} />
                <span style={{ fontSize: 10, fontWeight: 500, color: '#aaa', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Live transcript</span>
              </div>
              <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '1fr 1fr', minHeight: 0, overflow: 'hidden' }}>
                {/* Pou — navy, left-aligned, newest first */}
                <div ref={pouTranscriptRef} style={{ overflowY: 'auto', padding: '10px 8px', borderRight: '0.5px solid #f0ede6', display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {transcript.filter(l => l.label === 'Pou' || l.label === 'Caller' || l.label === 'Pouroa').length === 0 && (
                    <div style={{ fontSize: 11, color: '#bbb', fontStyle: 'italic', padding: '4px 6px' }}>Nothing yet…</div>
                  )}
                  {transcript.filter(l => l.label === 'Pou' || l.label === 'Caller' || l.label === 'Pouroa').slice().reverse().map(line => (
                    <div key={line.id} style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', animation: 'msgSlideIn 0.25s ease' }}>
                      <div style={{ background: '#1a237e', color: '#fff', padding: '8px 12px', borderRadius: 18, borderBottomLeftRadius: 4, fontSize: 12, lineHeight: 1.4, maxWidth: '92%', wordBreak: 'break-word' }}>{line.text}</div>
                      <div style={{ fontSize: 10, color: '#bbb', marginTop: 3, paddingLeft: 4 }}>{line.time}</div>
                    </div>
                  ))}
                </div>
                {/* Tradie — amber, right-aligned, newest first */}
                <div ref={transcriptRef} style={{ overflowY: 'auto', padding: '10px 8px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {transcript.filter(l => l.label !== 'Pou' && l.label !== 'Caller' && l.label !== 'Pouroa').length === 0 && (
                    <div style={{ fontSize: 11, color: '#bbb', fontStyle: 'italic', padding: '4px 6px' }}>Nothing yet…</div>
                  )}
                  {transcript.filter(l => l.label !== 'Pou' && l.label !== 'Caller' && l.label !== 'Pouroa').slice().reverse().map(line => (
                    <div key={line.id} style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', animation: 'msgSlideIn 0.25s ease' }}>
                      <div style={{ background: '#f59e0b', color: '#1a1a1a', padding: '8px 12px', borderRadius: 18, borderBottomRightRadius: 4, fontSize: 12, lineHeight: 1.4, maxWidth: '92%', wordBreak: 'break-word' }}>{line.text}</div>
                      <div style={{ fontSize: 10, color: '#bbb', marginTop: 3, paddingRight: 4 }}>{line.time}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Bottom bar — WS status + test cockpit */}
          <div style={{
            background: '#fff',
            borderTop: '0.5px solid #e8e6df',
            padding: '8px 16px',
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            flexShrink: 0,
          }}>
            <span style={{
              display: 'inline-block', width: 6, height: 6, borderRadius: '50%',
              background: wsStatus === 'connected' ? '#4caf50' : wsStatus === 'connecting' ? '#fbbf24' : '#f87171',
            }} />
            <span style={{ fontSize: 11, color: wsStatus === 'connected' ? '#4caf50' : '#888', fontFamily: 'monospace' }}>
              WS {wsStatus}
            </span>
            {lastWsMsg && (
              <span style={{ fontSize: 11, color: '#aaa', fontFamily: 'monospace' }}>last: {lastWsMsg}</span>
            )}
            <div style={{ flex: 1 }} />
            <button
              onClick={() => wsRef.current?.send(JSON.stringify({ type: 'manual_start' }))}
              style={{ fontSize: 11, background: '#1a237e', color: '#fff', border: 'none', borderRadius: 4, padding: '3px 10px', cursor: 'pointer', fontFamily: 'monospace' }}
            >
              ▶ test cockpit
            </button>
            <button
              onClick={() => {
                setIsLive(false)
                setClaudeFeed([])
                setTranscript([])
                setMood('Neutral')
                setHeat(5)
                setInstinct('Waiting for the call…')
                setObjection(null)
                setCallDuration(0)
              }}
              style={{ fontSize: 11, background: '#555', color: '#fff', border: 'none', borderRadius: 4, padding: '3px 10px', cursor: 'pointer', fontFamily: 'monospace' }}
            >
              ■ end test
            </button>
          </div>
        </div>
      </div>

      <style>{`
        @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
        @keyframes slideIn { from { opacity: 0; transform: translateY(-6px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes msgSlideIn { from { opacity: 0; transform: translateY(-8px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes pulseGreenBorder { 0%, 100% { box-shadow: inset 0 0 0 2px #4caf5055; } 50% { box-shadow: inset 0 0 0 2px #4caf50cc; } }
        ::-webkit-scrollbar { width: 4px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: #ddd; border-radius: 2px; }
      `}</style>
    </div>
  )
}

