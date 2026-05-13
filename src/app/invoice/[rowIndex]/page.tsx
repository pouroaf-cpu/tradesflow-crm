'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter, useParams, useSearchParams } from 'next/navigation'
import type { InvoiceRow } from '@/lib/invoiceSheets'

function formatCurrency(val: string): string {
  const n = parseFloat(val.replace(/[$,]/g, ''))
  if (isNaN(n)) return '—'
  return '$' + n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

function overdueLabel(days: number): string {
  if (days < 0) return `Due in ${-days} day${days === -1 ? '' : 's'}`
  if (days === 0) return 'Due today'
  return `${days} day${days === 1 ? '' : 's'} overdue`
}

function urgencyColor(days: number): string {
  if (days < 0) return '#3b82f6'
  if (days <= 7) return '#f59e0b'
  if (days <= 30) return '#f97316'
  return '#ef4444'
}

function initials(name: string) {
  return name.split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase() || '?'
}

export default function InvoicePage() {
  const params = useParams()
  const searchParams = useSearchParams()
  const router = useRouter()
  const rowIndex = Number(params.rowIndex)

  const [invoice, setInvoice] = useState<InvoiceRow | null>(null)
  const [loading, setLoading] = useState(true)

  const queueParam = searchParams.get('queue')
  const queue = queueParam ? queueParam.split(',').map(Number) : []
  const currentIndex = queue.indexOf(rowIndex)
  const nextInQueue = currentIndex >= 0 && currentIndex < queue.length - 1 ? queue[currentIndex + 1] : null
  const prevInQueue = currentIndex > 0 ? queue[currentIndex - 1] : null

  const fetchInvoice = useCallback(async () => {
    const res = await fetch('/api/invoices')
    if (res.status === 401) { router.push('/login'); return }
    const data = await res.json()
    const found = (data.invoices || []).find((i: InvoiceRow) => i.rowIndex === rowIndex)
    if (!found) { router.push('/invoices'); return }
    setInvoice(found)
    setLoading(false)
  }, [rowIndex, router])

  useEffect(() => { fetchInvoice() }, [fetchInvoice])

  useEffect(() => {
    if (queueParam && queue.length > 0) {
      localStorage.setItem('ara_inv_queue', queueParam)
      localStorage.setItem('ara_inv_queue_current', String(rowIndex))
    }
  }, [queueParam, rowIndex])

  function goNext() {
    if (nextInQueue) router.push(`/invoice/${nextInQueue}?queue=${queueParam}`)
    else {
      localStorage.removeItem('ara_inv_queue')
      localStorage.removeItem('ara_inv_queue_current')
      router.push('/invoices')
    }
  }

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', color: 'var(--muted)' }}>
      Loading...
    </div>
  )

  if (!invoice) return null

  const color = urgencyColor(invoice.daysOverdue)

  return (
    <div style={{ display: 'grid', gridTemplateRows: 'auto 1fr', minHeight: '100vh' }}>

      <div style={{
        background: 'var(--surface)', borderBottom: '1px solid var(--border)',
        padding: '0 1.25rem', height: 48,
        display: 'flex', alignItems: 'center', gap: 12,
        position: 'sticky', top: 0, zIndex: 10,
      }}>
        <button className="btn-ghost" onClick={() => router.push('/invoices')} style={{ padding: '4px 10px', fontSize: 13 }}>
          ← Back
        </button>
        {queue.length > 0 && (
          <span style={{ fontSize: 12, color: 'var(--muted)' }}>
            {currentIndex + 1} / {queue.length}
          </span>
        )}
        <div style={{ flex: 1 }} />
        {prevInQueue && (
          <button className="btn-ghost" onClick={() => router.push(`/invoice/${prevInQueue}?queue=${queueParam}`)}
            style={{ fontSize: 12, padding: '4px 10px' }}>← Prev</button>
        )}
        {queue.length > 0 && (
          <button className="btn-primary" onClick={goNext} style={{ fontSize: 13 }}>
            {nextInQueue ? 'Next →' : 'Done ✓'}
          </button>
        )}
      </div>

      <div style={{
        display: 'grid', gridTemplateColumns: '300px 1fr',
        height: 'calc(100vh - 48px)', overflow: 'hidden',
      }}>

        <div style={{
          background: 'var(--surface)', borderRight: '1px solid var(--border)',
          padding: '28px 20px', display: 'flex', flexDirection: 'column', gap: 24, overflowY: 'auto',
        }}>

          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <div style={{
              width: 48, height: 48, borderRadius: '50%',
              background: '#1e3a5f', color: '#60a5fa',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontWeight: 600, fontSize: 15, flexShrink: 0,
            }}>
              {initials(invoice.debtorName)}
            </div>
            <div>
              <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 2 }}>{invoice.debtorName || '—'}</div>
              <div style={{ fontSize: 13, color: 'var(--muted)' }}>{invoice.clientName || '—'}</div>
            </div>
          </div>

          {invoice.debtorPhone && (
            <a href={`tel:${invoice.debtorPhone.replace(/\s/g, '')}`} style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
              padding: '12px 16px', borderRadius: 8,
              background: '#16a34a', color: '#fff',
              textDecoration: 'none', fontSize: 15, fontWeight: 700,
            }}>
              📞 {invoice.debtorPhone}
            </a>
          )}

          <div style={{
            padding: '10px 14px', borderRadius: 8,
            background: color + '1a', border: `1px solid ${color}44`,
            textAlign: 'center',
          }}>
            <div style={{ fontSize: 20, fontWeight: 700, color }}>{overdueLabel(invoice.daysOverdue)}</div>
            {invoice.callTypeDue && (
              <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>
                Next: {invoice.callTypeDue} {invoice.callDue && `· ${invoice.callDue}`}
              </div>
            )}
          </div>

          <div>
            <div style={sectionLabel}>Invoice</div>
            {[
              ['Number',   invoice.invoiceNumber],
              ['Total',    formatCurrency(invoice.invoiceTotal)],
              ['Owing',    formatCurrency(invoice.amountOwing)],
              ['Paid',     formatCurrency(invoice.amountPaid)],
              ['Due date', invoice.dueDate],
              ['Stage',    invoice.currentStage],
            ].map(([label, value]) => (
              <div key={label} style={fieldRow}>
                <span style={{ color: 'var(--muted)', fontSize: 13 }}>{label}</span>
                <span style={{ fontSize: 13, fontWeight: 500 }}>{value}</span>
              </div>
            ))}
          </div>
        </div>

        <div style={{ padding: '32px 40px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div>
            <div style={{ fontSize: 22, fontWeight: 600, marginBottom: 4 }}>Call history</div>
            <div style={{ fontSize: 14, color: 'var(--muted)' }}>
              {invoice.invoiceNumber} · {invoice.debtorName}
            </div>
          </div>

          {invoice.callHistory.length === 0 ? (
            <div style={{
              background: 'var(--surface)', border: '1px solid var(--border)',
              borderRadius: 'var(--radius)', padding: '2rem', textAlign: 'center',
              color: 'var(--muted)', fontSize: 14,
            }}>
              No calls logged yet — the daily scheduler will record calls automatically.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {invoice.callHistory.map((entry, i) => (
                <div key={i} style={{
                  background: 'var(--surface)', border: '1px solid var(--border)',
                  borderRadius: 'var(--radius)', padding: '14px 18px',
                  display: 'flex', alignItems: 'center', gap: 14,
                }}>
                  <div style={{
                    width: 36, height: 36, borderRadius: '50%', flexShrink: 0,
                    background: 'var(--accent-dim)', color: 'var(--accent)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 11, fontWeight: 700,
                  }}>
                    {entry.label.replace('OD ', '')}
                  </div>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>{entry.label}</div>
                    <div style={{ fontSize: 12, color: 'var(--muted)' }}>{entry.date}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

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
          }
          div[style*="padding: 32px 40px"] {
            padding: 20px 16px !important;
          }
        }
      `}</style>
    </div>
  )
}

const sectionLabel: React.CSSProperties = {
  fontSize: 11, fontWeight: 600, color: 'var(--muted)',
  textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10,
}

const fieldRow: React.CSSProperties = {
  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
  padding: '8px 0', borderBottom: '1px solid var(--border)',
}
