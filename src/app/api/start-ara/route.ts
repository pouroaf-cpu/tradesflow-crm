import { exec, spawn } from 'child_process'
import { NextResponse } from 'next/server'

const PYTHON = 'C:\\Program Files\\Python39\\pythonw.exe'
const SERVER = 'C:\\Users\\PFrew\\Projects\\Tradeflow\\tradesflow-crm\\server.py'
const CWD = 'C:\\Users\\PFrew\\Projects\\Tradeflow\\tradesflow-crm'

export async function POST() {
  await new Promise<void>(resolve => {
    exec('taskkill /F /IM pythonw.exe', () => resolve())
  })

  const child = spawn(PYTHON, [SERVER], {
    detached: true,
    stdio: 'ignore',
    cwd: CWD,
  })
  child.unref()

  return NextResponse.json({ ok: true })
}
