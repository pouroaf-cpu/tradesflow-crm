import { NextRequest, NextResponse } from 'next/server'
import { isAuthenticated } from '@/lib/auth'
import { getAllContacts } from '@/lib/sheets'

export async function GET(req: NextRequest) {
  if (!isAuthenticated()) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const contacts = await getAllContacts()
    return NextResponse.json({ contacts })
  } catch (err) {
    console.error('Sheets error:', err)
    return NextResponse.json({ error: 'Failed to load contacts' }, { status: 500 })
  }
}
