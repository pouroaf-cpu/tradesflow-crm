import { cookies } from 'next/headers'

const SESSION_SECRET = process.env.SESSION_SECRET || 'tradesflow-secret'
const COOKIE_NAME = 'tf_session'

export function createSessionToken(): string {
  const payload = `${Date.now()}:${SESSION_SECRET}`
  return Buffer.from(payload).toString('base64')
}

export function validateSessionToken(token: string): boolean {
  try {
    const decoded = Buffer.from(token, 'base64').toString('utf8')
    return decoded.endsWith(`:${SESSION_SECRET}`)
  } catch {
    return false
  }
}

export function isAuthenticated(): boolean {
  const cookieStore = cookies()
  const session = cookieStore.get(COOKIE_NAME)
  if (!session) return false
  return validateSessionToken(session.value)
}

export { COOKIE_NAME }
