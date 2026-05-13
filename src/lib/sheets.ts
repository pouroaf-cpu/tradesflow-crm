import { google } from 'googleapis'

function makeClient(envVar: string, emailEnvVar?: string, privateKeyEnvVar?: string) {
  const raw = process.env[envVar]
  let clientEmail: string | undefined
  let privateKey: string | undefined

  if (raw) {
    let parsed: Record<string, string>
    try {
      parsed = JSON.parse(raw)
    } catch {
      throw new Error(`Invalid JSON in ${envVar}`)
    }
    clientEmail = parsed.client_email
    privateKey = parsed.private_key
  } else if (emailEnvVar && privateKeyEnvVar) {
    clientEmail = process.env[emailEnvVar]
    privateKey = process.env[privateKeyEnvVar]
  }

  if (!clientEmail || !privateKey) {
    throw new Error(`Missing Google Sheets credentials for ${envVar}`)
  }

  const auth = new google.auth.JWT({
    email: clientEmail,
    key: privateKey.replace(/\\n/g, '\n'),
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  })

  return google.sheets({ version: 'v4', auth })
}

export function getCrmSheetsClient() {
  return makeClient(
    'CRM_GOOGLE_SERVICE_ACCOUNT_JSON',
    'GOOGLE_SERVICE_ACCOUNT_EMAIL',
    'GOOGLE_PRIVATE_KEY'
  )
}

export function getQueueSheetsClient() {
  return makeClient(
    'QUEUE_GOOGLE_SERVICE_ACCOUNT_JSON',
    'GOOGLE_SERVICE_ACCOUNT_EMAIL',
    'GOOGLE_PRIVATE_KEY'
  )
}

export function getCrmSheetId(): string {
  const id = process.env.CRM_GOOGLE_SHEET_ID || process.env.GOOGLE_SHEET_ID
  if (!id) throw new Error('Missing CRM_GOOGLE_SHEET_ID or GOOGLE_SHEET_ID')
  return id
}

export function getQueueSheetId(): string {
  const id = process.env.QUEUE_GOOGLE_SHEET_ID
  if (!id) throw new Error('Missing QUEUE_GOOGLE_SHEET_ID')
  return id
}

export function getOutboundSheetId(): string {
  return (
    process.env.OUTBOUND_GOOGLE_SHEET_ID ||
    process.env.GOOGLE_SHEET_ID ||
    process.env.CRM_GOOGLE_SHEET_ID ||
    '14AE0ka8OENgs_qhXSwAtiWzZEreCy97BGxxCEcM17l4'
  )
}

export function getOutboundTabName(): string {
  return process.env.OUTBOUND_GOOGLE_SHEET_TAB_NAME || 'Outbound'
}

// ─── Contact (cold-call CRM) ─────────────────────────────────────────────────

export type Contact = {
  rowIndex: number
  name: string
  tradeType: string
  phone: string
  mobile: string
  region: string
  pipelineStage: string
  callOutcome: string
  lastCall: string
  nextActionDate: string
  attempts: string
  decisionMaker: string
  notes: string
}

function rowToContact(row: string[], rowIndex: number): Contact {
  return {
    rowIndex,
    name: row[0] || '',
    tradeType: row[1] || '',
    phone: row[2] || '',
    mobile: row[3] || '',
    region: row[4] || '',
    pipelineStage: row[5] || 'Cold',
    callOutcome: row[6] || '',
    lastCall: row[7] || '',
    nextActionDate: row[8] || '',
    attempts: row[9] || '0',
    decisionMaker: row[10] || '',
    notes: row[11] || '',
  }
}

export async function getAllContacts(): Promise<Contact[]> {
  const sheets = getCrmSheetsClient()
  const spreadsheetId = getOutboundSheetId()
  const tabName = getOutboundTabName()
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${tabName}!A2:L`,
  })
  const rows = res.data.values || []
  return rows
    .map((row, i) => rowToContact(row, i + 2))
    .filter(c => c.name && c.name.toLowerCase() !== 'name')
}

export async function updateContact(
  rowIndex: number,
  fields: Partial<Omit<Contact, 'rowIndex'>>
) {
  const sheets = getCrmSheetsClient()
  const spreadsheetId = getOutboundSheetId()
  const tabName = getOutboundTabName()

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${tabName}!A${rowIndex}:L${rowIndex}`,
  })
  const currentRow: string[] = res.data.values?.[0] || Array(12).fill('')

  const updated = [...currentRow]
  if (fields.name !== undefined) updated[0] = fields.name
  if (fields.tradeType !== undefined) updated[1] = fields.tradeType
  if (fields.phone !== undefined) updated[2] = fields.phone
  if (fields.mobile !== undefined) updated[3] = fields.mobile
  if (fields.region !== undefined) updated[4] = fields.region
  if (fields.pipelineStage !== undefined) updated[5] = fields.pipelineStage
  if (fields.callOutcome !== undefined) updated[6] = fields.callOutcome
  if (fields.lastCall !== undefined) updated[7] = fields.lastCall
  if (fields.nextActionDate !== undefined) updated[8] = fields.nextActionDate
  if (fields.attempts !== undefined) updated[9] = fields.attempts
  if (fields.decisionMaker !== undefined) updated[10] = fields.decisionMaker
  if (fields.notes !== undefined) updated[11] = fields.notes

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${tabName}!A${rowIndex}:L${rowIndex}`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [updated] },
  })
}

// ─── Outbound SMS automation ──────────────────────────────────────────────────

export type OutboundRow = {
  rowNumber: number
  name: string
  phone: string
  isMobile: string
  callOutcome: string
  smsSentAt: string
}

export async function getClosedOutboundRowsPendingSms(): Promise<OutboundRow[]> {
  const sheets = getCrmSheetsClient()
  const spreadsheetId = getOutboundSheetId()
  const tabName = getOutboundTabName()

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${tabName}!A:Z`,
  })

  const rows = response.data.values || []
  const pending: OutboundRow[] = []

  for (let index = 1; index < rows.length; index++) {
    const row = rows[index]
    const callOutcome = String(row[6] || '').trim()
    const smsSentAt = String(row[12] || '').trim()

    if (callOutcome.toLowerCase() !== 'closed') continue
    if (smsSentAt) continue

    pending.push({
      rowNumber: index + 1,
      name: String(row[0] || '').trim(),
      phone: String(row[2] || '').trim(),
      isMobile: String(row[3] || '').trim(),
      callOutcome,
      smsSentAt,
    })
  }

  return pending
}

export async function markOutboundClosedSmsResult(
  rowNumber: number,
  sentAt: string,
  status: string,
  providerMessageId = ''
) {
  const sheets = getCrmSheetsClient()
  const spreadsheetId = getOutboundSheetId()
  const tabName = getOutboundTabName()

  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId,
    requestBody: {
      valueInputOption: 'USER_ENTERED',
      data: [
        { range: `${tabName}!M${rowNumber}`, values: [[sentAt]] },
        { range: `${tabName}!N${rowNumber}`, values: [[status]] },
        { range: `${tabName}!O${rowNumber}`, values: [[providerMessageId]] },
      ],
    },
  })
}
