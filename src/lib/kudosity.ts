const KUDOSITY_SEND_SMS_URL = 'https://api.transmitsms.com/send-sms.json'

type SendSmsResult = {
  ok: boolean
  messageId?: string
  error?: string
}

function normaliseNzMobile(raw: string): string {
  const trimmed = raw.trim()
  if (!trimmed) return ''

  const compact = trimmed.replace(/[^\d+]/g, '')
  if (compact.startsWith('+')) return compact
  if (compact.startsWith('64')) return `+${compact}`
  if (compact.startsWith('0')) return `+64${compact.slice(1)}`
  return compact
}

export function getClosedCustomerSmsMessage(name: string): string {
  const greeting = name ? `Hi ${name}, ` : 'Hi, '

  return `${greeting}it was great talking with you. We know Tradeflow is not right for you just now, but if that changes or you want to talk further, here is our website: https://tradeflow.org.nz`
}

export async function sendKudositySms(to: string, message: string): Promise<SendSmsResult> {
  const apiKey = process.env.KUDOSITY_API_KEY
  const apiSecret = process.env.KUDOSITY_API_SECRET

  if (!apiKey || !apiSecret) {
    throw new Error('Missing Kudosity API credentials')
  }

  const normalisedTo = normaliseNzMobile(to)
  if (!normalisedTo) {
    return { ok: false, error: 'Missing recipient phone number' }
  }
  if (!normalisedTo.startsWith('+642')) {
    return { ok: false, error: 'Recipient phone number is not a NZ mobile' }
  }

  const auth = Buffer.from(`${apiKey}:${apiSecret}`).toString('base64')
  const body = new URLSearchParams({
    to: normalisedTo,
    message,
  })

  const response = await fetch(KUDOSITY_SEND_SMS_URL, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body,
  })

  const payload = await response.json().catch(() => null)

  if (!response.ok) {
    return {
      ok: false,
      error: payload?.error?.description || payload?.message || response.statusText,
    }
  }

  const providerErrorCode = payload?.error?.code
  const providerErrorDescription = payload?.error?.description

  if (providerErrorCode && providerErrorCode !== 'SUCCESS') {
    return {
      ok: false,
      error: providerErrorDescription || providerErrorCode,
    }
  }

  return {
    ok: true,
    messageId: payload?.message_id ? String(payload.message_id) : '',
  }
}
