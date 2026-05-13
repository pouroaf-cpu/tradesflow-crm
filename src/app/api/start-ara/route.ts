import { spawn } from 'child_process'
import net from 'net'
import { NextResponse } from 'next/server'

const PYTHON = 'C:\\Program Files\\Python39\\pythonw.exe'
const SERVER = 'C:\\Users\\PFrew\\Projects\\Tradeflow\\tradesflow-crm\\server.py'
const CWD = 'C:\\Users\\PFrew\\Projects\\Tradeflow\\tradesflow-crm'

function isPortInUse(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const srv = net.createServer()
    srv.once('error', () => resolve(true))
    srv.once('listening', () => { srv.close(); resolve(false) })
    srv.listen(port, '127.0.0.1')
  })
}

export async function POST() {
  const running = await isPortInUse(5000)
  if (running) {
    return NextResponse.json({ ok: true, status: 'already_running' })
  }

  const child = spawn(PYTHON, [SERVER], {
    detached: true,
    stdio: 'ignore',
    cwd: CWD,
  })
  child.unref()

  return NextResponse.json({ ok: true, status: 'started' })
}
