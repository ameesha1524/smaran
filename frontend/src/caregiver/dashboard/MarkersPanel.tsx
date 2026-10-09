import type { DashboardView } from '../../lib/types'

/**
 * The few plain numbers a clinician recognises. They sit beside the domain
 * levels and are never folded into them. A marker the games have not measured
 * yet says so, which is different from a marker of zero.
 */

function Marker({ name, value, unit, meaning }: { name: string; value: number | null | undefined; unit?: string; meaning: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-2xl px-4 py-3" style={{ background: 'rgba(8,15,30,0.5)' }}>
      <span className="font-sans" style={{ fontSize: 14, color: 'var(--chalk-dim)' }}>
        {name}
      </span>
      <span className="font-serif" style={{ fontSize: 28 }}>
        {value === null || value === undefined ? 'not measured yet' : `${Math.round(value)}${unit ?? ''}`}
      </span>
      <span className="font-sans" style={{ fontSize: 13, color: 'var(--chalk-dim)' }}>
        {meaning}
      </span>
    </div>
  )
}

export default function MarkersPanel({ markers }: { markers: DashboardView['markers'] }) {
  return (
    <section className="soft-panel p-5">
      <h2 className="font-serif" style={{ fontSize: 24 }}>
        Clinician markers
      </h2>
      <p className="mb-3 font-sans" style={{ fontSize: 14, color: 'var(--chalk-dim)' }}>
        Numbers a doctor will recognise. They describe how she played, not what is wrong.
      </p>
      <div className="grid gap-3 sm:grid-cols-3">
        <Marker
          name="Working-memory span"
          value={markers?.workingMemorySpan}
          unit=" things"
          meaning="The most she held in mind at once, cleanly, at least twice (Duck Roll Call)."
        />
        <Marker
          name="Inhibition breakdown tier"
          value={markers?.inhibitionBreakdownTier}
          meaning="Where holding back a reaction starts to give way. Needs a game that asks for it."
        />
        <Marker
          name="Trajectory precision"
          value={markers?.trajectoryPrecisionMs}
          unit=" ms"
          meaning="How closely she follows something that moves. Needs a game that asks for it."
        />
      </div>
    </section>
  )
}
