import { deviceBlob } from './api'

/**
 * Her family's photographs and voices, for a screen that cannot send a token.
 *
 * The server serves a tablet's files at /api/device/media/..., and only hers. An image or audio tag cannot send
 * the tablet's token, so the file is fetched with it here and handed to the page as a blob address. The service
 * worker keeps these files (their address contains her id, so no one else's tablet is ever served them), which is
 * what lets the grove work with no signal.
 *
 * Anything that is not the tablet's own media path is returned as it is.
 */

const DEVICE_MEDIA = '/api/device/media/'
const resolved = new Map<string, string>()

export async function resolveMedia(url: string | undefined): Promise<string | undefined> {
  if (!url) return undefined
  if (!url.startsWith(DEVICE_MEDIA)) return url
  const cached = resolved.get(url)
  if (cached) return cached
  const blob = await deviceBlob(url)
  if (!blob) return undefined
  const local = URL.createObjectURL(blob)
  resolved.set(url, local)
  return local
}

/** Forget every blob address, e.g. when the tablet is handed to another patient. */
export function forgetMedia(): void {
  for (const local of resolved.values()) URL.revokeObjectURL(local)
  resolved.clear()
}
