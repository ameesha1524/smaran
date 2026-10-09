import { describe, expect, it } from 'vitest'
import { parseSse } from './sse'

describe('reading the dashboard stream', () => {
  it('reads a complete message', () => {
    const { messages, rest } = parseSse('event:session\ndata:{"sessionId":"s1"}\n\n')
    expect(messages).toEqual([{ event: 'session', data: '{"sessionId":"s1"}' }])
    expect(rest).toBe('')
  })

  it('keeps an unfinished message until the rest of it arrives', () => {
    const first = parseSse('event:alert\ndata:{"id":"a')
    expect(first.messages).toEqual([])
    const second = parseSse(first.rest + '1"}\n\n')
    expect(second.messages).toEqual([{ event: 'alert', data: '{"id":"a1"}' }])
  })

  it('reads several messages at once, in order', () => {
    const { messages } = parseSse('event:ready\ndata:{}\n\nevent:session\ndata:{"n":1}\n\nevent:garden\ndata:{"n":2}\n\n')
    expect(messages.map((m) => m.event)).toEqual(['ready', 'session', 'garden'])
  })

  it('drops keep-alive comments and understands CRLF and a space after the colon', () => {
    const { messages } = parseSse(': keep-alive\r\n\r\nevent: bloom\r\ndata: {"stage":2}\r\n\r\n')
    expect(messages).toEqual([{ event: 'bloom', data: '{"stage":2}' }])
  })

  it('joins a message that spans several data lines', () => {
    expect(parseSse('data:one\ndata:two\n\n').messages).toEqual([{ event: 'message', data: 'one\ntwo' }])
  })

  it('does not choke on junk', () => {
    expect(parseSse('').messages).toEqual([])
    expect(parseSse('\n\n\n\n').messages).toEqual([])
    expect(parseSse('nonsense without a colon\n\n').messages).toEqual([])
  })
})
