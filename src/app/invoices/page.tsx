'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import type { InvoiceRow } from '@/lib/invoiceSheets'

const FILTERS = ['All', 'Pre-Due', 'Overdue', 'Urgent (30d+)']

function formatCurrency(val: string): string {
  const n = parseFloat(val.replace(/[$,]/g, ''))
  if (isNaN(n)) return '—'
  return '$' + n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

function overdueLabel(days: number): string {
  if (days < 0) return `Due in ${-days}d`
  if (days === 0) return 'Due today'
  return `${days}d overdue`
}

function urgencyColor(days: number): string {
  if (days < 0) return '#3b82f6'
  if (days <= 7) return '#f59e0b'
  if (days <= 30) return '#f97316'
  return '#ef4444'
}

export default function InvoicesPage() {
  const [invoices, setInvoices] = useState<InvoiceRow[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('All')
  const [search, setSearch] = useState('')
  const [queueSize, setQueueSize] = useState(10)
  const [savedQueue, setSavedQueue] = useState<{ queue: string; current: string } | null>(null)
  const router = useRouter()

  const fetchInvoices = useCallback(async () => {
    const res = await fetch('/api/invoices')
    if (res.status === 401) { router.push('/login'); return }
    const data = await res.json()
    setInvoices(data.invoices || [])
    setLoading(false)
  }, [router])

  useEffect(() => { fetchInvoices() }, [fetchInvoices])

  useEffect(() => {
    const q = localStorage.getItem('ara_inv_queue')
    const c = localStorage.getItem('ara_inv_queue_current')
    if (q && c) setSavedQueue({ queue: q, current: c })
  }, [])

  async function logout() {
    await fetch('/api/auth', { method: 'DELETE' })
    router.push('/login')
  }

  const filtered = invoices.filter(inv => {
    const matchSearch = !search ||
      inv.debtorName.toLowerCase().includes(search.toLowerCase()) ||
      inv.invoiceNumber.toLowerCase().includes(search.toLowerCase()) ||
      inv.clientName.toLowerCase().includes(search.toLowerCase()) ||
      inv.debtorPhone.includes(search)

    const matchFilter =
      filter === 'All' ||
      (filter === 'Pre-Due' && inv.daysOverdue < 0) ||
      (filter === 'Overdue' && inv.daysOverdue >= 0) ||
      (filter === 'Urgent (30d+)' && inv.daysOverdue >= 30)

    return matchSearch && matchFilter
  })

  const filterCounts = {
    'All': invoices.length,
    'Pre-Due': invoices.filter(i => i.daysOverdue < 0).length,
    'Overdue': invoices.filter(i => i.daysOverdue >= 0).length,
    'Urgent (30d+)': invoices.filter(i => i.daysOverdue >= 30).length,
  }

  function buildQueue() {
    const sorted = [...filtered].sort((a, b) => b.daysOverdue - a.daysOverdue)
    const queue = sorted.slice(0, queueSize)
    const ids = queue.map(i => i.rowIndex).join(',')
    const firstId = queue[0].rowIndex
    localStorage.setItem('ara_inv_queue', ids)
    localStorage.setItem('ara_inv_queue_current', String(firstId))
    setSavedQueue(null)
    router.push(`/invoice/${firstId}?queue=${ids}`)
  }

  function resumeQueue() {
    if (!savedQueue) return
    router.push(`/invoice/${savedQueue.current}?queue=${savedQueue.queue}`)
  }

  function clearQueue() {
    localStorage.removeItem('ara_inv_queue')
    localStorage.removeItem('ara_inv_queue_current')
    setSavedQueue(null)
  }

  return (
    <div style={{ minHeight: '100vh', paddingBottom: '4rem' }}>

      <div style={{
        background: 'var(--surface)', borderBottom: '1px solid var(--border)',
        padding: '1rem 1.25rem', display: 'flex', alignItems: 'center',
        justifyContent: 'space-between', position: 'sticky', top: 0, zIndex: 10,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <div>
            <span style={{ color: 'var(--accent)', fontWeight: 700, fontSize: 14, letterSpacing: '0.06em' }}>ARA</span>
            <span style={{ color: 'var(--muted)', fontSize: 13, marginLeft: 8 }}>Webapp</span>
          </div>
          <div style={{ display: 'flex', gap: 4 }}>
            <Link href="/dashboard" style={{
              fontSize: 13, fontWeight: 500, padding: '5px 12px', borderRadius: 6,
              background: 'transparent', color: 'var(--muted)', border: '1px solid var(--border)',
            }}>Cold Calls</Link>
            <Link href="/invoices" style={{
              fontSize: 13, fontWeight: 600, padding: '5px 12px', borderRadius: 6,
              background: 'var(--accent-dim)', color: 'var(--accent)', border: '1px solid var(--accent)',
            }}>Invoices</Link>
          </div>
        </div>
        <button className="btn-ghost" onClick={logout} style={{ padding: '6px 12px', fontSize: 12 }}>Log out</button>
      </div>

      <div style={{ padding: '1.25rem' }}>

        {savedQueue && (
          <div style={{
            background: '#1a2e1a', border: '1px solid #16a34a', borderRadius: 'var(--radius)',
            padding: '12px 16px', marginBottom: '1rem',
            display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
          }}>
            <span style={{ fontSize: 16 }}>⏸️</span>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#4ade80' }}>Invoice queue in progress</div>
              <div style={{ fontSize: 12, color: 'var(--muted)' }}>Pick up where you left off</div>
            </div>
            <button className="btn-primary" onClick={resumeQueue} style={{ fontSize: 13, padding: '7px 16px' }}>▶ Resume</button>
            <button className="btn-ghost" onClick={clearQueue} style={{ fontSize: 12, padding: '7px 12px', color: 'var(--muted)' }}>Discard</button>
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: '1.25rem' }}>
          {FILTERS.map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              style={{
                borderRadius: 20, padding: '4px 14px', fontSize: 12, fontWeight: 500, cursor: 'pointer',
                background: filter === f ? urgencyColor(f === 'Pre-Due' ? -1 : f === 'Overdue' ? 1 : f === 'Urgent (30d+)' ? 31 : 0) : 'var(--surface)',
                color: filter === f ? '#fff' : 'var(--muted)',
                border: `1px solid ${filter === f ? 'transparent' : 'var(--border)'}`,
              }}
            >
              {f} <span style={{ opacity: 0.75 }}>{filterCounts[f as keyof typeof filterCounts]}</span>
            </button>
          ))}
        </div>

        <div style={{ display: 'flex', gap: 8, marginBottom: '1rem', flexWrap: 'wrap' }}>
          <input
            placeholder="Search debtor, invoice number, client..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{ flex: 1, minWidth: 200 }}
          />
        </div>

        <div style={{
          background: 'var(--surface)', border: '1px solid var(--border)',
          borderRadius: 'var(--radius)', padding: '1rem 1.25rem',
          marginBottom: '1.25rem', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
        }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 2 }}>Build a call queue</div>
            <div style={{ fontSize: 12, color: 'var(--muted)' }}>
              {filtered.length} invoices match — most overdue first
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <select value={queueSize} onChange={e => setQueueSize(Number(e.target.value))} style={{ width: 90 }}>
              {[5, 10, 15, 20].map(n => <option key={n} value={n}>{n} calls</option>)}
            </select>
            <button className="btn-primary" onClick={buildQueue} disabled={filtered.length === 0}>
              Start queue →
            </button>
          </div>
        </div>

        {loading ? (
          <div style={{ color: 'var(--muted)', textAlign: 'center', padding: '3rem' }}>Loading invoices...</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {filtered.map(inv => (
              <div
                key={inv.rowIndex}
                onClick={() => router.push(`/invoice/${inv.rowIndex}`)}
                style={{
                  background: 'var(--surface)', border: '1px solid var(--border)',
                  borderRadius: 'var(--radius)', padding: '0.85rem 1.1rem',
                  cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 12,
                  transition: 'border-color 0.15s',
                }}
                onMouseEnter={e => (e.currentTarget.style.borderColor = '#444')}
                onMouseLeave={e => (e.currentTarget.style.borderColor = 'var(--border)')}
              >
                <div style={{
                  width: 3, borderRadius: 2, alignSelf: 'stretch',
                  background: urgencyColor(inv.daysOverdue), flexShrink: 0,
                }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 500, fontSize: 14, marginBottom: 2 }}>
                    {inv.debtorName || '(no name)'}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--muted)', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {inv.clientName && <span>{inv.clientName}</span>}
                    {inv.invoiceNumber && <span>{inv.invoiceNumber}</span>}
                    {inv.debtorPhone && <span>{inv.debtorPhone}</span>}
                  </div>
                </div>
                <div style={{ textAlign: 'right', flexShrink: 0 }}>
                  <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 2 }}>
                    {formatCurrency(inv.amountOwing)}
                  </div>
                  <div style={{ fontSize: 11, color: urgencyColor(inv.daysOverdue), fontWeight: 500 }}>
                    {overdueLabel(inv.daysOverdue)}
                  </div>
                </div>
                <div style={{ flexShrink: 0 }}>
                  <span style={{
                    fontSize: 11, fontWeight: 600, padding: '3px 9px', borderRadius: 20,
                    background: 'var(--surface2)', color: 'var(--muted)', border: '1px solid var(--border)',
                  }}>
                    {inv.currentStage}
                  </span>
                </div>
              </div>
            ))}
            {filtered.length === 0 && !loading && (
              <div style={{ color: 'var(--muted)', textAlign: 'center', padding: '3rem' }}>
                No invoices match your filters
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
