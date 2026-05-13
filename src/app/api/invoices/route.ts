import { NextRequest, NextResponse } from 'next/server'
import { isAuthenticated } from '@/lib/auth'
import { getUnpaidInvoices } from '@/lib/invoiceSheets'

export async function GET(req: NextRequest) {
  if (!isAuthenticated()) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  try {
    const invoices = await getUnpaidInvoices()
    return NextResponse.json({ invoices })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('Invoice fetch error:', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
