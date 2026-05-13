import { NextRequest, NextResponse } from 'next/server'
import { isAuthenticated } from '@/lib/auth'
import { updateContact } from '@/lib/sheets'

export async function PATCH(req: NextRequest) {
  if (!isAuthenticated()) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = await req.json()
    const { rowIndex, ...fields } = body

    if (!rowIndex) {
      return NextResponse.json({ error: 'rowIndex required' }, { status: 400 })
    }

    await updateContact(rowIndex, fields)
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('Update error:', err)
    return NextResponse.json({ error: 'Failed to update contact' }, { status: 500 })
  }
}
