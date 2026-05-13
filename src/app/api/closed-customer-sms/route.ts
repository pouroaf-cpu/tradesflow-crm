import { NextRequest, NextResponse } from 'next/server'

import {
  getClosedOutboundRowsPendingSms,
  markOutboundClosedSmsResult,
} from '@/lib/sheets'
import { getClosedCustomerSmsMessage, sendKudositySms } from '@/lib/kudosity'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

function nzTimestamp(): string {
  return new Date().toLocaleString('en-NZ', { timeZone: 'Pacific/Auckland' })
}

export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET
  const authHeader = request.headers.get('authorization')

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (!process.env.KUDOSITY_API_KEY || !process.env.KUDOSITY_API_SECRET) {
    return NextResponse.json(
      { error: 'Kudosity API credentials are not configured' },
      { status: 503 }
    )
  }

  const pendingRows = await getClosedOutboundRowsPendingSms()
  const results: Array<{
    rowNumber: number
    name: string
    status: 'sent' | 'failed' | 'skipped'
    messageId?: string
    error?: string
  }> = []

  for (const row of pendingRows) {
    const message = getClosedCustomerSmsMessage(row.name)
    const sentAt = nzTimestamp()
    const mobileValue = row.isMobile.toLowerCase()

    if (mobileValue && !['yes', 'y', 'true', 'mobile'].includes(mobileValue)) {
      await markOutboundClosedSmsResult(
        row.rowNumber,
        sentAt,
        'Closed SMS skipped: not marked as mobile'
      )
      results.push({
        rowNumber: row.rowNumber,
        name: row.name,
        status: 'skipped',
      })
      continue
    }

    try {
      const result = await sendKudositySms(row.phone, message)

      if (result.ok) {
        await markOutboundClosedSmsResult(
          row.rowNumber,
          sentAt,
          'Closed SMS sent',
          result.messageId
        )
        results.push({
          rowNumber: row.rowNumber,
          name: row.name,
          status: 'sent',
          messageId: result.messageId,
        })
      } else {
        await markOutboundClosedSmsResult(
          row.rowNumber,
          sentAt,
          `Closed SMS failed: ${result.error || 'Unknown error'}`
        )
        results.push({
          rowNumber: row.rowNumber,
          name: row.name,
          status: 'failed',
          error: result.error,
        })
      }
    } catch (error) {
      const messageText = error instanceof Error ? error.message : 'Unknown error'
      await markOutboundClosedSmsResult(
        row.rowNumber,
        sentAt,
        `Closed SMS failed: ${messageText}`
      )
      results.push({
        rowNumber: row.rowNumber,
        name: row.name,
        status: 'failed',
        error: messageText,
      })
    }
  }

  return NextResponse.json({
    ok: true,
    checked: pendingRows.length,
    sent: results.filter((result) => result.status === 'sent').length,
    failed: results.filter((result) => result.status === 'failed').length,
    skipped: results.filter((result) => result.status === 'skipped').length,
    results,
  })
}
