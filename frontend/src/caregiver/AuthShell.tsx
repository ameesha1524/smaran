import type { ReactNode } from 'react'
import Sanctuary from '../scenes/Sanctuary'

/**
 * The frame the sign-in and sign-up screens share: the pond, receded, and a
 * single calm panel in front of it. Deliberately a form that behaves like a
 * form: this person is tired, probably on a phone, probably in another city.
 */
export default function AuthShell({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return (
    <div className="relative min-h-screen w-full overflow-hidden">
      <Sanctuary phase="night" bloomStage={2} recede />
      <div className="relative z-20 mx-auto flex min-h-screen max-w-md flex-col justify-center gap-7 px-6 py-8">
        <div>
          <h1 className="inscription font-serif" style={{ fontSize: 40 }}>
            {title}
          </h1>
          <p className="mt-2 font-sans" style={{ fontSize: 16, color: 'var(--chalk-dim)' }}>
            {subtitle}
          </p>
        </div>
        {children}
      </div>
    </div>
  )
}

export const fieldStyle = {
  background: 'rgba(8,15,30,0.7)',
  border: '1px solid rgba(221,234,248,0.2)',
  color: 'var(--chalk)',
  fontSize: 18,
} as const

export function Field({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: ReactNode
}) {
  return (
    <label className="flex flex-col gap-2">
      <span style={{ fontSize: 15, color: 'var(--chalk-dim)' }}>{label}</span>
      {children}
      {hint && <span style={{ fontSize: 13, color: 'var(--chalk-dim)', opacity: 0.75 }}>{hint}</span>}
    </label>
  )
}
