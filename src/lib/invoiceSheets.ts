import { getQueueSheetsClient } from '@/lib/sheets'

const SHEET_TAB = 'Call Queue'

function getInvoiceSheetId(): string {
  const id = process.env.INVOICE_SHEET_ID || process.env.QUEUE_GOOGLE_SHEET_ID
  if (!id) throw new Error('Missing INVOICE_SHEET_ID or QUEUE_GOOGLE_SHEET_ID')
  return id
}

const CALL_STAGES = [
  { label: 'Pre-Due', colIndex: 11 },
  { label: 'OD 3',   colIndex: 12 },
  { label: 'OD 7',   colIndex: 13 },
  { label: 'OD 10',  colIndex: 14 },
  { label: 'OD 13',  colIndex: 15 },
  { label: 'OD 16',  colIndex: 16 },
  { label: 'OD 19',  colIndex: 17 },
  { label: 'OD 22',  colIndex: 18 },
  { label: 'OD 25',  colIndex: 19 },
  { label: 'OD 28',  colIndex: 20 },
  { label: 'OD 31',  colIndex: 21 },
  { label: 'OD 34',  colIndex: 22 },
  { label: 'OD 37',  colIndex: 23 },
  { label: 'OD 40',  colIndex: 24 },
  { label: 'OD 43',  colIndex: 25 },
  { label: 'OD 46',  colIndex: 26 },
  { label: 'OD 49',  colIndex: 27 },
  { label: 'OD 52',  colIndex: 28 },
  { label: 'OD 55',  colIndex: 29 },
  { label: 'OD 58',  colIndex: 30 },
]

export type InvoiceRow = {
  rowIndex: number
  clientName: string
  debtorName: string
  debtorPhone: string
  invoiceNumber: string
  invoiceTotal: string
  amountOwing: string
  amountPaid: string
  invoiceDate: string
  dueDate: string
  paidStatus: string
  initialCall: string
  callDue: string
  callTypeDue: string
  callHistory: { label: string; date: string }[]
  daysOverdue: number
  currentStage: string
}

function parseDDMMYYYY(s: string): Date | null {
  const parts = s.split('/')
  if (parts.length !== 3) return null
  const [dd, mm, yyyy] = parts.map(Number)
  if (!dd || !mm || !yyyy) return null
  return new Date(yyyy, mm - 1, dd)
}

function rowToInvoice(row: string[], rowIndex: number, today: Date): InvoiceRow {
  const callHistory = CALL_STAGES
    .map(s => ({ label: s.label, date: row[s.colIndex] || '' }))
    .filter(s => s.date)

  const completedStages = CALL_STAGES.filter(s => row[s.colIndex]?.trim())
  const currentStage = completedStages.length > 0
    ? completedStages[completedStages.length - 1].label
    : 'Initial'

  const dueDateParsed = parseDDMMYYYY(row[8] || '')
  const daysOverdue = dueDateParsed
    ? Math.round((today.getTime() - dueDateParsed.getTime()) / 86_400_000)
    : 0

  return {
    rowIndex,
    clientName:    row[0]  || '',
    debtorName:    row[1]  || '',
    debtorPhone:   row[2]  || '',
    invoiceNumber: row[3]  || '',
    invoiceTotal:  row[4]  || '',
    amountOwing:   row[5]  || '',
    amountPaid:    row[6]  || '',
    invoiceDate:   row[7]  || '',
    dueDate:       row[8]  || '',
    paidStatus:    row[9]  || '',
    initialCall:   row[10] || '',
    callDue:       row[31] || '',
    callTypeDue:   row[32] || '',
    callHistory,
    daysOverdue,
    currentStage,
  }
}

export async function getUnpaidInvoices(): Promise<InvoiceRow[]> {
  const sheets = getQueueSheetsClient()
  const spreadsheetId = getInvoiceSheetId()

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${SHEET_TAB}!A2:AG`,
  })

  const rows = res.data.values || []
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())

  return rows
    .map((row, i) => rowToInvoice(row, i + 2, today))
    .filter(inv => inv.paidStatus !== 'Paid' && inv.invoiceNumber)
    .sort((a, b) => b.daysOverdue - a.daysOverdue)
}
