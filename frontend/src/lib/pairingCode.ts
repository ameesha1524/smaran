/**
 * The shape of a pairing code, as the tablet reads what is typed.
 *
 * The same 27 symbols as the server (PairingService.ALPHABET): no 0/O, 1/I/L,
 * 5/S or 8/B, nothing that reads as something else across a room. Six of them,
 * shown as HJ4K-2M. The server is the one that decides whether a code is real;
 * this only keeps the typing tidy.
 */

export const PAIRING_ALPHABET = 'ACDEFGHJKMNPQRTUVWXYZ234679'
export const PAIRING_CODE_LENGTH = 6

/** Whatever was typed or pasted, reduced to the symbols a code can contain, capitalised, at most six. */
export function normaliseTyped(raw: string): string {
  let out = ''
  for (const ch of raw.toUpperCase()) {
    if (PAIRING_ALPHABET.includes(ch)) out += ch
    if (out.length === PAIRING_CODE_LENGTH) break
  }
  return out
}

/** HJ4K-2M. Anything shorter is grouped as far as it goes. */
export function formatCode(code: string): string {
  return code.length > 4 ? `${code.slice(0, 4)}-${code.slice(4)}` : code
}

export function isComplete(code: string): boolean {
  return code.length === PAIRING_CODE_LENGTH
}
