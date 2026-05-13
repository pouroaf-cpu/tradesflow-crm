'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import type { Contact } from '@/lib/sheets'

const STAGES = ['All', 'Uncalled', 'Contacted', 'Interested', 'Follow-up Booked', 'Closed', 'Not Interested']

const STAGE_COLORS: Record<string, { bg: string; color: string; border: string }> = {
  'Uncalled':         { bg: '#f1efe8', color: '#666',    border: '#ddd' },
  'Contacted':        { bg: '#e3f2fd', color: '#1565c0', border: '#bbdefb' },
  'Interested':       { bg: '#fff8e1', color: '#e65100', border: '#ffe082' },
  'Follow-up Booked': { bg: '#ede7f6', color: '#4527a0', border: '#d1c4e9' },
  'Closed':           { bg: '#e8f5e9', color: '#2e7d32', border: '#c8e6c9' },
  'Not Interested':   { bg: '#ffebee', color: '#b71c1c', border: '#ffcdd2' },
}

function normaliseStage(s: string) {
  if (!s || s === 'Cold') return 'Uncalled'
  return s
}

export default function Dashboard() {
  const [contacts, setContacts] = useState<Contact[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [stageFilter, setStageFilter] = useState('All')
  const [regionFilter, setRegionFilter] = useState('All')
  const [queueSize, setQueueSize] = useState(10)
  const [savedQueue, setSavedQueue] = useState<{ queue: string; current: string } | null>(null)
  const router = useRouter()

  const fetchContacts = useCallback(async () => {
    const res = await fetch('/api/contacts')
    if (res.status === 401) { router.push('/login'); return }
    const data = await res.json()
    setContacts(data.contacts || [])
    setLoading(false)
  }, [router])

  useEffect(() => { fetchContacts() }, [fetchContacts])

  useEffect(() => {
    fetch('/api/start-ara', { method: 'POST' }).catch(() => {})
  }, [])

  useEffect(() => {
    const q = localStorage.getItem('tf_queue')
    const c = localStorage.getItem('tf_queue_current')
    if (q && c) setSavedQueue({ queue: q, current: c })
  }, [])

  const regions = ['All', ...Array.from(new Set(contacts.map(c => c.region).filter(Boolean)))]

  const filtered = contacts.filter(c => {
    const normStage = normaliseStage(c.pipelineStage)
    const matchSearch = !search ||
      c.name.toLowerCase().includes(search.toLowerCase()) ||
      c.tradeType.toLowerCase().includes(search.toLowerCase()) ||
      (c.phone + c.mobile).includes(search)
    const matchStage = stageFilter === 'All' || normStage === stageFilter
    const matchRegion = regionFilter === 'All' || c.region === regionFilter
    return matchSearch && matchStage && matchRegion
  })

  function buildQueue() {
    const priority = ['Interested', 'Follow-up Booked', 'Contacted', 'Uncalled']
    const sorted = [...filtered].sort((a, b) => {
      const ai = priority.indexOf(normaliseStage(a.pipelineStage))
      const bi = priority.indexOf(normaliseStage(b.pipelineStage))
      return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi)
    })
    const queue = sorted.slice(0, queueSize)
    const ids = queue.map(c => c.rowIndex).join(',')
    const firstId = queue[0].rowIndex

    localStorage.setItem('tf_queue', ids)
    localStorage.setItem('tf_queue_current', String(firstId))
    setSavedQueue(null)

    router.push(`/contact/${firstId}?queue=${ids}`)
  }

  function resumeQueue() {
    if (!savedQueue) return
    router.push(`/contact/${savedQueue.current}?queue=${savedQueue.queue}`)
  }

  function clearQueue() {
    localStorage.removeItem('tf_queue')
    localStorage.removeItem('tf_queue_current')
    setSavedQueue(null)
  }

  async function logout() {
    await fetch('/api/auth', { method: 'DELETE' })
    router.push('/login')
  }

  const stageCounts = STAGES.slice(1).reduce((acc, s) => {
    acc[s] = contacts.filter(c => normaliseStage(c.pipelineStage) === s).length
    return acc
  }, {} as Record<string, number>)

  return (
    <div style={{ minHeight: '100vh', padding: '0 0 4rem' }}>
      <div style={{
        background: 'var(--surface)',
        borderBottom: '0.5px solid var(--border)',
        padding: '0 1.25rem',
        height: 44,
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        position: 'sticky',
        top: 0,
        zIndex: 10,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <div>
            <span style={{ color: 'var(--accent)', fontWeight: 700, fontSize: 14, letterSpacing: '0.06em' }}>ARA</span>
            <span style={{ color: 'var(--muted)', fontSize: 13, marginLeft: 8 }}>Webapp</span>
          </div>
          <div style={{ display: 'flex', gap: 4 }}>
            <Link href="/dashboard" style={{
              fontSize: 13, fontWeight: 600, padding: '5px 12px', borderRadius: 6,
              background: 'var(--accent-dim)', color: 'var(--accent)', border: '1px solid var(--accent)',
            }}>Cold Calls</Link>
            <Link href="/invoices" style={{
              fontSize: 13, fontWeight: 500, padding: '5px 12px', borderRadius: 6,
              background: 'transparent', color: 'var(--muted)', border: '1px solid var(--border)',
            }}>Invoices</Link>
          </div>
        </div>
        <div style={{ flex: 1 }} />
        <button className="btn-ghost" onClick={logout} style={{ padding: '5px 10px', fontSize: 12 }}>Log out</button>
      </div>

      <div style={{ padding: '1.25rem' }}>

        {savedQueue && (
          <div style={{
            background: '#f0fdf4',
            border: '0.5px solid #bbf7d0',
            borderRadius: 'var(--radius)',
            padding: '11px 16px',
            marginBottom: '1rem',
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            flexWrap: 'wrap',
          }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 500, color: '#15803d' }}>Queue in progress</div>
              <div style={{ fontSize: 12, color: 'var(--muted)' }}>You left a call queue — pick up where you left off</div>
            </div>
            <button onClick={resumeQueue} style={{ fontSize: 12, fontWeight: 500, border: 'none', borderRadius: 6, padding: '6px 14px', background: '#16a34a', color: '#fff', cursor: 'pointer' }}>
              ▶ Resume queue
            </button>
            <button onClick={clearQueue} style={{ fontSize: 12, border: '0.5px solid var(--border)', borderRadius: 6, padding: '6px 12px', background: '#fff', color: 'var(--muted)', cursor: 'pointer' }}>
              Discard
            </button>
          </div>
        )}

        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: '1.25rem' }}>
          {STAGES.slice(1).map(s => {
            const sc = STAGE_COLORS[s]
            const active = stageFilter === s
            return (
              <button
                key={s}
                onClick={() => setStageFilter(stageFilter === s ? 'All' : s)}
                style={{
                  background: sc?.bg ?? 'var(--surface)',
                  color: sc?.color ?? 'var(--muted)',
                  border: `0.5px solid ${active ? (sc?.border ?? 'var(--border)') : 'var(--border)'}`,
                  outline: active ? `1.5px solid ${sc?.border ?? 'transparent'}` : 'none',
                  borderRadius: 20,
                  padding: '4px 12px',
                  fontSize: 12,
                  fontWeight: active ? 600 : 400,
                  cursor: 'pointer',
                }}
              >
                {s} <span style={{ opacity: 0.7 }}>{stageCounts[s] || 0}</span>
              </button>
            )
          })}
          {stageFilter !== 'All' && (
            <button onClick={() => setStageFilter('All')} className="btn-ghost" style={{ borderRadius: 20, padding: '4px 12px', fontSize: 12 }}>
              clear ×
            </button>
          )}
        </div>

        <div style={{ display: 'flex', gap: 8, marginBottom: '1rem', flexWrap: 'wrap' }}>
          <input
            placeholder="Search name, trade, phone..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{ flex: 1, minWidth: 180 }}
          />
          <select value={regionFilter} onChange={e => setRegionFilter(e.target.value)} style={{ width: 140 }}>
            {regions.map(r => <option key={r}>{r}</option>)}
          </select>
        </div>

        <div style={{
          background: 'var(--surface)',
          border: '0.5px solid var(--border)',
          borderRadius: 'var(--radius)',
          padding: '12px 16px',
          marginBottom: '1.25rem',
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          flexWrap: 'wrap',
        }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 2 }}>Build a call queue</div>
            <div style={{ fontSize: 12, color: 'var(--muted)' }}>
              {filtered.length} contacts match — prioritises warm leads first
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <select value={queueSize} onChange={e => setQueueSize(Number(e.target.value))} style={{ width: 90 }}>
              {[5, 10, 15, 20].map(n => <option key={n} value={n}>{n} calls</option>)}
            </select>
            <button className="btn-primary" onClick={buildQueue} disabled={filtered.length === 0} style={{ fontSize: 12, padding: '7px 16px' }}>
              Start queue →
            </button>
          </div>
        </div>

        {loading ? (
          <div style={{ color: 'var(--muted)', textAlign: 'center', padding: '3rem' }}>Loading contacts...</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            {filtered.map(c => {
              const normStage = normaliseStage(c.pipelineStage)
              const sc = STAGE_COLORS[normStage]
              return (
                <div
                  key={c.rowIndex}
                  onClick={() => router.push(`/contact/${c.rowIndex}`)}
                  style={{
                    background: 'var(--surface)',
                    border: '0.5px solid var(--border)',
                    borderRadius: 9,
                    padding: '11px 14px',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    transition: 'border-color 0.12s',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.borderColor = '#c5cae9')}
                  onMouseLeave={e => (e.currentTarget.style.borderColor = 'var(--border)')}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 500, fontSize: 13, marginBottom: 2 }}>{c.name || '(no name)'}</div>
                    <div style={{ fontSize: 11, color: 'var(--muted)', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      {c.tradeType && <span>{c.tradeType}</span>}
                      {c.region && <span>{c.region}</span>}
                      {c.phone && <span>{c.phone}</span>}
                      {c.attempts && c.attempts !== '0' && <span>{c.attempts} attempts</span>}
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                    {c.nextActionDate && (
                      <span style={{ fontSize: 11, color: 'var(--accent)', fontWeight: 500, display: 'flex', alignItems: 'center', gap: 4 }}>
                        📅 {c.nextActionDate}
                      </span>
                    )}
                    <span style={{
                      fontSize: 11,
                      fontWeight: 500,
                      padding: '3px 9px',
                      borderRadius: 20,
                      background: sc?.bg ?? '#f1efe8',
                      color: sc?.color ?? '#666',
                    }}>
                      {normStage}
                    </span>
                  </div>
                </div>
              )
            })}
            {filtered.length === 0 && (
              <div style={{ color: 'var(--muted)', textAlign: 'center', padding: '3rem' }}>
                No contacts match your filters
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
