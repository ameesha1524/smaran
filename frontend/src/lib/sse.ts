import { getAccessToken, refreshSession } from './api'

/**
 * Live updates for a dashboard: "something changed, go and look".
 *
 * A browser's own EventSource cannot send an Authorization header, and the
 * access token must not travel in a URL (it would end up in logs). So the stream
 * is read with fetch, which can, and parsed here.
 *
 * An event carries ids only (see DashboardEvents on the server). The dashboard
 * reacts by asking the ordinary, authorised endpoints again, so a stream can
 * never show more than a dashboard may read.
 *
 * The connection lasts thirty minutes on the server and is reopened here with a
 * fresh token. If the server answers 403 or 404 her access has ended, and the
 * stream stops for good rather than retrying.
 */

export interface SseMessage {
  event: string
  data: string
}

/**
 * Pulls complete messages out of a buffer of stream text and returns what is
 * left over (an unfinished message waits for the next chunk). Comment lines,
 * which the server sends as keep-alives, are dropped.
 */
export function parseSse(buffer: string): { messages: SseMessage[]; rest: string } {
  const messages: SseMessage[] = []
  const normalised = buffer.replace(/\r\n/g, '\n')
  const blocks = normalised.split('\n\n')
  const rest = blocks.pop() ?? ''
  for (const block of blocks) {
    let event = 'message'
    const data: string[] = []
    for (const line of block.split('\n')) {
      if (line.startsWith(':') || line === '') continue
      const colon = line.indexOf(':')
      const field = colon === -1 ? line : line.slice(0, colon)
      const value = colon === -1 ? '' : line.slice(colon + 1).replace(/^ /, '')
      if (field === 'event') event = value
      else if (field === 'data') data.push(value)
    }
    if (data.length > 0 || event !== 'message') messages.push({ event, data: data.join('\n') })
  }
  return { messages, rest }
}

const RETRY_MS = 4000

/**
 * Watch one patient. Returns a function that stops watching.
 *
 * @param onChange called with the event name ("session", "alert", "garden", "bloom" ...)
 * @param onState  called with true when the stream is open and false when it is not
 */
export function watchPatient(
  patientId: string,
  onChange: (event: string, data: unknown) => void,
  onState?: (live: boolean) => void,
): () => void {
  let stopped = false
  const controller = new AbortController()

  const pause = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms))

  void (async () => {
    while (!stopped) {
      try {
        const res = await fetch(`/api/caregiver/patients/${encodeURIComponent(patientId)}/events`, {
          headers: { Authorization: `Bearer ${getAccessToken() ?? ''}`, Accept: 'text/event-stream' },
          signal: controller.signal,
        })
        if (res.status === 401 && (await refreshSession())) continue
        if (res.status === 401 || res.status === 403 || res.status === 404) break
        if (!res.ok || !res.body) throw new Error(`stream refused: ${res.status}`)

        onState?.(true)
        const reader = res.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''
        while (!stopped) {
          const { value, done } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })
          const parsed = parseSse(buffer)
          buffer = parsed.rest
          for (const m of parsed.messages) {
            if (m.event === 'ready') continue
            let data: unknown = m.data
            try {
              data = JSON.parse(m.data)
            } catch {
              /* a plain-text event: pass it through */
            }
            onChange(m.event, data)
          }
        }
      } catch {
        /* offline, or the server went away: try again below */
      }
      onState?.(false)
      if (!stopped) await pause(RETRY_MS)
    }
    onState?.(false)
  })()

  return () => {
    stopped = true
    controller.abort()
  }
}
