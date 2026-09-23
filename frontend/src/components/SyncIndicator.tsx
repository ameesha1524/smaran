import { useSmaran } from '../state/SmaranContext'

/**
 * "Offline — your garden is still growing."
 *
 * Connectivity is a fact about the building, not about her. This indicator is
 * always visible, always calm, and never uses a red dot or the word "error".
 */

function relative(ts: number | null): string {
  if (!ts) return 'not synced yet'
  const mins = Math.floor((Date.now() - ts) / 60000)
  if (mins < 1) return 'Last synced just now'
  if (mins < 60) return `Last synced ${mins} minute${mins === 1 ? '' : 's'} ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `Last synced ${hours} hour${hours === 1 ? '' : 's'} ago`
  const days = Math.floor(hours / 24)
  return `Last synced ${days} day${days === 1 ? '' : 's'} ago`
}

export default function SyncIndicator({ className = '' }: { className?: string }) {
  const { online, pending, syncedAt } = useSmaran()

  const text = !online
    ? 'Offline — your garden is still growing'
    : pending > 0
      ? 'Syncing…'
      : relative(syncedAt)

  return (
    <div
      className={`flex items-center gap-2 font-sans ${className}`}
      style={{ fontSize: 13, color: 'var(--chalk-dim)', opacity: 0.7 }}
      aria-live="polite"
    >
      <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
        <circle
          cx="6"
          cy="6"
          r="3.4"
          fill="none"
          stroke={online ? 'var(--olive-light)' : 'var(--chalk-dim)'}
          strokeWidth="1.4"
          strokeDasharray={online ? undefined : '2 2'}
        />
      </svg>
      {text}
    </div>
  )
}
