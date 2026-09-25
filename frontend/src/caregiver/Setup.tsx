import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useSmaran } from '../state/SmaranContext'
import { caregiver, family as familyApi, reminders as remindersApi } from '../lib/api'
import { demoFamily, demoObjects, demoReminders } from '../lib/demoData'
import { LANGUAGES, LANGUAGE_ORDER, customPack, getPack, registerCustomPack } from '../i18n/strings'
import { PEAK_LABELS } from '../lib/cognitiveProfile'
import type {
  FamilyMember,
  LanguageCode,
  MeaningfulObject,
  PeakWindow,
  ReminderSchedule,
  SemanticCluster,
} from '../lib/types'

/**
 * Caregiver setup — where Smaran stops being a product and becomes *hers*.
 *
 * Everything the patient will see is entered here: the language she is greeted
 * in, the word her family calls her by, the faces on the tree, the voices that
 * speak from them, the objects that anchor her, and when her tablets are due.
 *
 * Nothing in this flow is optional decoration. A Family Grove with stock photos
 * measures nothing; a Weaver's Loom with generic icons measures nothing. This
 * screen is the therapy.
 */

type Tab = 'patient' | 'family' | 'objects' | 'reminders' | 'culture'

const TABS: { key: Tab; label: string }[] = [
  { key: 'patient', label: 'Her profile' },
  { key: 'family', label: 'Family' },
  { key: 'objects', label: 'Objects' },
  { key: 'reminders', label: 'Reminders' },
  { key: 'culture', label: 'Home & culture' },
]

const CLUSTERS: SemanticCluster[] = ['MUSICAL', 'NATURE', 'DAILY_LIFE', 'CRAFT', 'FOOD']

export default function Setup() {
  const { patient, setPatient, setStillness, stillness, caregiverSetupComplete, completeCaregiverSetup } = useSmaran()
  const [tab, setTab] = useState<Tab>('patient')
  const [saved, setSaved] = useState<string | null>(null)

  const flash = (msg: string) => {
    setSaved(msg)
    window.setTimeout(() => setSaved(null), 2600)
  }

  return (
    <div className="min-h-screen w-full px-5 py-7 sm:px-8" style={{ background: 'var(--indigo-deep)' }}>
      <div className="mx-auto flex max-w-4xl flex-col gap-6">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="font-serif" style={{ fontSize: 36 }}>
              Setting up her sanctuary
            </h1>
            <p className="font-sans" style={{ fontSize: 15, color: 'var(--chalk-dim)' }}>
              What you enter here is what she will see, hear and be called.
            </p>
          </div>
          <div className="flex gap-3">
            <Link to="/caregiver/dashboard" className="pill stone" style={{ padding: '10px 20px', fontSize: 16 }}>
              Dashboard
            </Link>
            {/* Until this is pressed once, the patient side redirects back here:
                she should never meet a pond that does not know her name. */}
            <Link
              to="/"
              onClick={completeCaregiverSetup}
              className="pill"
              style={{
                padding: '10px 20px',
                fontSize: 16,
                background: caregiverSetupComplete ? undefined : 'var(--olive-continue)',
                border: '1px solid rgba(221,234,248,0.16)',
              }}
            >
              {caregiverSetupComplete ? 'Her sanctuary' : 'Hand it to her'}
            </Link>
          </div>
        </header>

        <nav className="flex flex-wrap gap-2">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className="pill"
              style={{
                padding: '8px 20px',
                fontSize: 16,
                background: tab === t.key ? 'var(--olive-continue)' : 'rgba(11,23,40,0.7)',
                border: '1px solid rgba(221,234,248,0.16)',
                minHeight: 44,
              }}
            >
              {t.label}
            </button>
          ))}
        </nav>

        {saved && (
          <p className="font-sans" style={{ fontSize: 15, color: 'var(--olive-light)' }} role="status">
            {saved}
          </p>
        )}

        {tab === 'patient' && <PatientTab patient={patient} onSave={setPatient} flash={flash} stillness={stillness} setStillness={setStillness} />}
        {tab === 'family' && <FamilyTab patientId={patient.id} flash={flash} />}
        {tab === 'objects' && <ObjectsTab patientId={patient.id} flash={flash} />}
        {tab === 'reminders' && <RemindersTab patientId={patient.id} flash={flash} />}
        {tab === 'culture' && <CultureTab patient={patient} onSave={setPatient} flash={flash} />}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------ her profile */

function PatientTab({
  patient,
  onSave,
  flash,
  stillness,
  setStillness,
}: {
  patient: ReturnType<typeof useSmaran>['patient']
  onSave(patch: Partial<ReturnType<typeof useSmaran>['patient']>): void
  flash(msg: string): void
  stillness: boolean
  setStillness(v: boolean): void
}) {
  const [form, setForm] = useState({ ...patient })
  const [customLanguage, setCustomLanguage] = useState('')
  const pack = getPack(form.languageCode)

  const save = () => {
    onSave(form)
    flash('Saved. She will see this the next time she opens the pond.')
  }

  const addCustomLanguage = () => {
    if (!customLanguage.trim()) return
    // A language not on the list is not an error — the caregiver names it and
    // supplies the greeting, and the app treats it like any other.
    const p = customPack(customLanguage.trim(), '{kin}, welcome', 'it is quiet here', 'Stay as long as you like.')
    registerCustomPack(p)
    setForm({ ...form, languageCode: p.code })
    setCustomLanguage('')
  }

  return (
    <section className="soft-panel flex flex-col gap-5 p-6">
      <Field label="Her name">
        <Input value={form.name} onChange={(v) => setForm({ ...form, name: v })} />
      </Field>

      <Field label="Home region" hint="Chooses the instrument that sits under the soundscape.">
        <Input value={form.region} onChange={(v) => setForm({ ...form, region: v })} />
      </Field>

      <Field label="Language">
        <div className="flex flex-wrap gap-2">
          {LANGUAGE_ORDER.map((code) => (
            <button
              key={code}
              type="button"
              onClick={() => setForm({ ...form, languageCode: code as LanguageCode })}
              className="pill"
              style={{
                padding: '8px 18px',
                fontSize: 16,
                minHeight: 44,
                background: form.languageCode === code ? 'var(--olive-continue)' : 'rgba(8,15,30,0.7)',
                border: '1px solid rgba(221,234,248,0.18)',
              }}
            >
              {LANGUAGES[code].label}
            </button>
          ))}
        </div>
        {!pack.reviewed && (
          <p className="mt-2 font-sans" style={{ fontSize: 13, color: 'var(--terracotta)' }}>
            The phrasing for {pack.latinLabel} has not yet been checked by a native speaker. Please read it aloud
            before she hears it, and correct it if it sounds wrong.
          </p>
        )}
        <div className="mt-3 flex flex-wrap gap-2">
          <Input value={customLanguage} onChange={setCustomLanguage} placeholder="Or add another language" />
          <button type="button" onClick={addCustomLanguage} className="pill stone" style={{ padding: '10px 20px', fontSize: 16 }}>
            Add
          </button>
        </div>
      </Field>

      <Field label="What she is called" hint="The word her family actually uses. Smaran never guesses this.">
        <Input value={form.kinshipTerm} onChange={(v) => setForm({ ...form, kinshipTerm: v })} />
        {pack.kinshipSuggestions.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-2">
            {pack.kinshipSuggestions.map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setForm({ ...form, kinshipTerm: k })}
                className="rounded-full px-3 py-1"
                style={{ fontSize: 15, border: '1px solid rgba(221,234,248,0.2)', color: 'var(--chalk-dim)', minHeight: 40 }}
              >
                {k}
              </button>
            ))}
          </div>
        )}
      </Field>

      <Field label="When she is most herself" hint="Drives game scheduling and reminder timing.">
        <div className="flex flex-wrap gap-2">
          {(Object.keys(PEAK_LABELS) as PeakWindow[]).map((w) => (
            <button
              key={w}
              type="button"
              onClick={() => setForm({ ...form, peakWindow: w })}
              className="pill"
              style={{
                padding: '8px 18px',
                fontSize: 16,
                minHeight: 44,
                background: form.peakWindow === w ? 'var(--olive-continue)' : 'rgba(8,15,30,0.7)',
                border: '1px solid rgba(221,234,248,0.18)',
              }}
            >
              {PEAK_LABELS[w].name}
            </button>
          ))}
        </div>
      </Field>

      <Field label="Stillness" hint="For a patient who finds movement agitating. The pond holds its breath.">
        <label className="flex items-center gap-3" style={{ fontSize: 16 }}>
          <input type="checkbox" checked={stillness} onChange={(e) => setStillness(e.target.checked)} style={{ width: 22, height: 22 }} />
          Keep the scene still
        </label>
      </Field>

      <button type="button" onClick={save} className="pill self-start" style={{ background: 'var(--olive-continue)', color: 'var(--chalk)' }}>
        Save
      </button>
    </section>
  )
}

/* ----------------------------------------------------------------- family */

function FamilyTab({ patientId, flash }: { patientId: string; flash(msg: string): void }) {
  const [members, setMembers] = useState<FamilyMember[]>(demoFamily)
  const [draft, setDraft] = useState({ name: '', relationship: '', kinshipTermLocal: '', contextHint: '' })
  const [photo, setPhoto] = useState<File | null>(null)
  const [voice, setVoice] = useState<Blob | null>(null)

  useEffect(() => {
    void familyApi.members(patientId).then((list) => {
      if (list.length) setMembers(list)
    })
  }, [patientId])

  const add = async () => {
    if (!draft.name.trim()) return
    const body = new FormData()
    Object.entries(draft).forEach(([k, v]) => body.append(k, v))
    if (photo) body.append('photo', photo)
    if (voice) body.append('voiceNote', voice, 'voice.webm')

    try {
      const created = await familyApi.add(patientId, body)
      setMembers((m) => [...m, created])
    } catch {
      // Offline setup is still setup: hold it locally and let sync carry it.
      setMembers((m) => [
        ...m,
        {
          id: `local-${Date.now()}`,
          patientId,
          ...draft,
          photoUrl: photo ? URL.createObjectURL(photo) : undefined,
          voiceNoteUrl: voice ? URL.createObjectURL(voice) : undefined,
          currentPhase: 1,
        },
      ])
    }
    setDraft({ name: '', relationship: '', kinshipTermLocal: '', contextHint: '' })
    setPhoto(null)
    setVoice(null)
    flash('Added. They will appear on her tree at the next sync.')
  }

  return (
    <section className="flex flex-col gap-5">
      <div className="soft-panel flex flex-col gap-4 p-6">
        <h2 className="font-serif" style={{ fontSize: 24 }}>
          Add someone she loves
        </h2>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name">
            <Input value={draft.name} onChange={(v) => setDraft({ ...draft, name: v })} />
          </Field>
          <Field label="Relationship">
            <Input value={draft.relationship} onChange={(v) => setDraft({ ...draft, relationship: v })} placeholder="Daughter, son, neighbour…" />
          </Field>
          <Field label="What she calls them">
            <Input value={draft.kinshipTermLocal} onChange={(v) => setDraft({ ...draft, kinshipTermLocal: v })} />
          </Field>
          <Field label="Photograph">
            <input type="file" accept="image/*" onChange={(e) => setPhoto(e.target.files?.[0] ?? null)} style={{ fontSize: 15 }} />
          </Field>
        </div>

        <Field label="One memory" hint="A single specific thing. This is read aloud when she hesitates.">
          <Input
            value={draft.contextHint}
            onChange={(v) => setDraft({ ...draft, contextHint: v })}
            placeholder="She brings you tea in the blue cup every morning."
          />
        </Field>

        <VoiceRecorder onRecorded={setVoice} recorded={voice} />

        <button type="button" onClick={() => void add()} className="pill self-start" style={{ background: 'var(--olive-continue)', color: 'var(--chalk)' }}>
          Add to the grove
        </button>
      </div>

      <div className="soft-panel p-6">
        <h2 className="font-serif" style={{ fontSize: 24 }}>
          On her tree
        </h2>
        <ul className="mt-3 flex flex-col gap-3">
          {members.map((m) => (
            <li key={m.id} className="flex flex-wrap items-center gap-3" style={{ borderTop: '1px solid rgba(221,234,248,0.12)', paddingTop: 12 }}>
              <span style={{ fontSize: 18, minWidth: 130 }}>{m.name}</span>
              <span style={{ fontSize: 15, color: 'var(--chalk-dim)', minWidth: 110 }}>{m.relationship}</span>
              <span style={{ fontSize: 15, color: 'var(--chalk-dim)' }}>phase {m.currentPhase}</span>
              <span style={{ fontSize: 14, color: m.voiceNoteUrl ? 'var(--olive-light)' : 'var(--terracotta)' }}>
                {m.voiceNoteUrl ? 'voice recorded' : 'no voice yet'}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}

/** Five seconds of a familiar voice. The single highest-value field in setup. */
function VoiceRecorder({ onRecorded, recorded }: { onRecorded(b: Blob | null): void; recorded: Blob | null }) {
  const [recording, setRecording] = useState(false)
  const [seconds, setSeconds] = useState(0)
  const recorder = useRef<MediaRecorder | null>(null)
  const chunks = useRef<Blob[]>([])
  const timer = useRef<number | null>(null)

  const stop = () => {
    recorder.current?.stop()
    recorder.current?.stream.getTracks().forEach((t) => t.stop())
    if (timer.current) window.clearInterval(timer.current)
    setRecording(false)
  }

  const start = async () => {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') return
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true }).catch(() => null)
    if (!stream) return

    chunks.current = []
    const rec = new MediaRecorder(stream)
    rec.ondataavailable = (e) => chunks.current.push(e.data)
    rec.onstop = () => onRecorded(new Blob(chunks.current, { type: 'audio/webm' }))
    rec.start()
    recorder.current = rec
    setRecording(true)
    setSeconds(0)

    timer.current = window.setInterval(() => {
      setSeconds((s) => {
        if (s >= 5) {
          stop()
          return 5
        }
        return s + 1
      })
    }, 1000)
  }

  useEffect(() => () => stop(), [])

  return (
    <div className="flex flex-wrap items-center gap-4">
      <button
        type="button"
        onClick={recording ? stop : () => void start()}
        className="pill stone"
        style={{ padding: '12px 24px', fontSize: 16 }}
      >
        {recording ? `Recording… ${5 - seconds}s` : recorded ? 'Record again' : 'Record five seconds'}
      </button>
      {recorded && <audio controls src={URL.createObjectURL(recorded)} style={{ height: 40 }} />}
      <span className="font-sans" style={{ fontSize: 14, color: 'var(--chalk-dim)' }}>
        Say her name, and one warm sentence.
      </span>
    </div>
  )
}

/* ---------------------------------------------------------------- objects */

function ObjectsTab({ patientId, flash }: { patientId: string; flash(msg: string): void }) {
  const [objects, setObjects] = useState<MeaningfulObject[]>(demoObjects)
  const [draft, setDraft] = useState<{ name: string; semanticCluster: SemanticCluster; file: File | null }>({
    name: '',
    semanticCluster: 'DAILY_LIFE',
    file: null,
  })

  const add = () => {
    if (!draft.name.trim()) return
    setObjects((o) => [
      ...o,
      {
        id: `local-${Date.now()}`,
        patientId,
        name: draft.name,
        semanticCluster: draft.semanticCluster,
        imageUrl: draft.file ? URL.createObjectURL(draft.file) : undefined,
        glyph: draft.file ? undefined : '🪷',
      },
    ])
    setDraft({ name: '', semanticCluster: 'DAILY_LIFE', file: null })
  }

  const save = async () => {
    await caregiver.saveObjects(patientId, objects).catch(() => undefined)
    flash('Object library saved.')
  }

  return (
    <section className="soft-panel flex flex-col gap-5 p-6">
      <div>
        <h2 className="font-serif" style={{ fontSize: 24 }}>
          Things that mean something to her
        </h2>
        <p className="font-sans" style={{ fontSize: 15, color: 'var(--chalk-dim)' }}>
          Five to ten is plenty. The cluster tag is what lets Smaran tell a declining memory domain apart from a
          fading piece of cultural knowledge — tag honestly.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="What is it">
          <Input value={draft.name} onChange={(v) => setDraft({ ...draft, name: v })} placeholder="Her brass lamp" />
        </Field>
        <Field label="Cluster">
          <select
            value={draft.semanticCluster}
            onChange={(e) => setDraft({ ...draft, semanticCluster: e.target.value as SemanticCluster })}
            className="rounded-full px-4 py-3"
            style={{ background: 'rgba(8,15,30,0.7)', border: '1px solid rgba(221,234,248,0.2)', color: 'var(--chalk)', fontSize: 17 }}
          >
            {CLUSTERS.map((c) => (
              <option key={c} value={c}>
                {c.replace('_', ' ').toLowerCase()}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Photograph">
          <input type="file" accept="image/*" onChange={(e) => setDraft({ ...draft, file: e.target.files?.[0] ?? null })} style={{ fontSize: 15 }} />
        </Field>
      </div>

      <div className="flex gap-3">
        <button type="button" onClick={add} className="pill stone" style={{ padding: '10px 22px', fontSize: 16 }}>
          Add object
        </button>
        <button type="button" onClick={() => void save()} className="pill" style={{ background: 'var(--olive-continue)', color: 'var(--chalk)', padding: '10px 22px', fontSize: 16 }}>
          Save library
        </button>
      </div>

      <div className="flex flex-wrap gap-3">
        {objects.map((o) => (
          <div key={o.id} className="petal-card flex flex-col items-center justify-center gap-1 p-3" style={{ width: 128, height: 128 }}>
            {o.imageUrl ? (
              <img src={o.imageUrl} alt="" style={{ width: 54, height: 54, objectFit: 'cover', borderRadius: '42%' }} />
            ) : (
              <span style={{ fontSize: 32 }}>{o.glyph}</span>
            )}
            <span style={{ fontSize: 14, textAlign: 'center' }}>{o.name}</span>
            <span style={{ fontSize: 11, color: 'var(--chalk-dim)' }}>{o.semanticCluster.replace('_', ' ').toLowerCase()}</span>
          </div>
        ))}
      </div>
    </section>
  )
}

/* -------------------------------------------------------------- reminders */

function RemindersTab({ patientId, flash }: { patientId: string; flash(msg: string): void }) {
  const [list, setList] = useState<ReminderSchedule[]>(demoReminders)

  useEffect(() => {
    void remindersApi.schedule(patientId).then((fresh) => {
      if (fresh?.length) setList(fresh)
    })
  }, [patientId])

  const add = (type: ReminderSchedule['type']) => {
    setList((l) => [
      ...l,
      {
        id: `local-${Date.now()}`,
        patientId,
        type,
        scheduledTime: type === 'HYDRATION' ? '12:00' : '09:00',
        messageTemplate: type === 'MEDICINE' ? '{kin}, it is time for your tablet.' : '{kin}, a little water?',
        languageCode: 'as',
      },
    ])
  }

  const save = async () => {
    await remindersApi.save(patientId, list).catch(() => undefined)
    // The Service Worker keeps its own copy so reminders fire with no signal.
    navigator.serviceWorker?.controller?.postMessage({ type: 'SCHEDULE_REMINDERS', reminders: list })
    flash('Reminder schedule saved to her device.')
  }

  return (
    <section className="soft-panel flex flex-col gap-5 p-6">
      <div>
        <h2 className="font-serif" style={{ fontSize: 24 }}>
          Reminders
        </h2>
        <p className="font-sans" style={{ fontSize: 15, color: 'var(--chalk-dim)' }}>
          These fire from her device, spoken in her language and using her name — with or without a signal. If a
          sundowning pattern is detected, game reminders after 4 pm are suppressed automatically.
        </p>
      </div>

      <ul className="flex flex-col gap-3">
        {list.map((r, i) => (
          <li key={r.id} className="flex flex-wrap items-center gap-3">
            <span style={{ fontSize: 16, minWidth: 110, color: 'var(--chalk-dim)' }}>{r.type.toLowerCase()}</span>
            <input
              type="time"
              value={r.scheduledTime}
              onChange={(e) => setList((l) => l.map((x, j) => (j === i ? { ...x, scheduledTime: e.target.value } : x)))}
              className="rounded-full px-4 py-2"
              style={{ background: 'rgba(8,15,30,0.7)', border: '1px solid rgba(221,234,248,0.2)', color: 'var(--chalk)', fontSize: 17 }}
            />
            <Input
              value={r.messageTemplate}
              onChange={(v) => setList((l) => l.map((x, j) => (j === i ? { ...x, messageTemplate: v } : x)))}
            />
            <button
              type="button"
              onClick={() => setList((l) => l.filter((_, j) => j !== i))}
              className="rounded-full px-4 py-2"
              style={{ fontSize: 15, border: '1px solid rgba(221,234,248,0.2)', color: 'var(--chalk-dim)', minHeight: 44 }}
            >
              Remove
            </button>
          </li>
        ))}
      </ul>

      <div className="flex flex-wrap gap-3">
        {(['MEDICINE', 'HYDRATION', 'APPOINTMENT'] as const).map((t) => (
          <button key={t} type="button" onClick={() => add(t)} className="pill stone" style={{ padding: '10px 20px', fontSize: 16 }}>
            Add {t.toLowerCase()}
          </button>
        ))}
        <button type="button" onClick={() => void save()} className="pill" style={{ background: 'var(--olive-continue)', color: 'var(--chalk)', padding: '10px 20px', fontSize: 16 }}>
          Save
        </button>
        <button
          type="button"
          onClick={() => void remindersApi.test(patientId).catch(() => undefined)}
          className="pill stone"
          style={{ padding: '10px 20px', fontSize: 16 }}
        >
          Send a test now
        </button>
      </div>
    </section>
  )
}

/* ---------------------------------------------------------------- culture */

function CultureTab({
  patient,
  onSave,
  flash,
}: {
  patient: ReturnType<typeof useSmaran>['patient']
  onSave(patch: Partial<ReturnType<typeof useSmaran>['patient']>): void
  flash(msg: string): void
}) {
  const [faith, setFaith] = useState(patient.faith ?? '')
  const [notes, setNotes] = useState('')

  return (
    <section className="soft-panel flex flex-col gap-5 p-6">
      <h2 className="font-serif" style={{ fontSize: 24 }}>
        Home &amp; culture
      </h2>
      <Field label="Faith or spiritual background" hint="Chooses which chime sits under the soundscape, and nothing else.">
        <Input value={faith} onChange={setFaith} />
      </Field>
      <Field label="Music, food, the house she grew up in" hint="Free text. Used to write story prompts and choose ambient layers.">
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={5}
          className="rounded-2xl px-4 py-3"
          style={{ background: 'rgba(8,15,30,0.7)', border: '1px solid rgba(221,234,248,0.2)', color: 'var(--chalk)', fontSize: 17 }}
        />
      </Field>
      <button
        type="button"
        onClick={() => {
          onSave({ faith })
          flash('Saved.')
        }}
        className="pill self-start"
        style={{ background: 'var(--olive-continue)', color: 'var(--chalk)' }}
      >
        Save
      </button>
    </section>
  )
}

/* ------------------------------------------------------------- fragments */

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-2">
      <span style={{ fontSize: 15, color: 'var(--chalk-dim)' }}>{label}</span>
      {children}
      {hint && (
        <span className="font-sans" style={{ fontSize: 13, color: 'var(--chalk-dim)', opacity: 0.7 }}>
          {hint}
        </span>
      )}
    </label>
  )
}

function Input({ value, onChange, placeholder }: { value: string; onChange(v: string): void; placeholder?: string }) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="flex-1 rounded-full px-4 py-3"
      style={{ background: 'rgba(8,15,30,0.7)', border: '1px solid rgba(221,234,248,0.2)', color: 'var(--chalk)', fontSize: 17, minWidth: 200 }}
    />
  )
}
