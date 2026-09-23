import { useEffect, useState } from 'react'

/**
 * Whether this device (or this patient) has asked for stillness.
 *
 * Games must branch on this in JavaScript rather than only in CSS: a drifting
 * object that stops drifting is not the same screen as one that was never
 * drifting, and the still version needs a layout of its own.
 */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(
    () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches,
  )

  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-reduced-motion: reduce)')
    if (!mq) return
    const on = () => setReduced(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])

  return reduced
}
