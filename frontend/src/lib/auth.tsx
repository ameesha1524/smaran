import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { auth as authApi, getDeviceToken, refreshSession, type AuthSession, type RegisterResult, type UserRole } from './api'

/**
 * Who is signed in, for the screens that need to know.
 *
 * This is for presentation only. It decides what to show and where to send
 * someone; it decides nothing about what they may see. The server checks every
 * request itself, so editing this in the browser's developer tools changes
 * the menu and nothing else.
 *
 * On first load the browser holds an HttpOnly refresh cookie if the person
 * signed in before. Trading it for an access token is how "still signed in"
 * survives a page reload without a long-lived secret in storage.
 */

export interface User {
  id: string
  name: string
  role: UserRole
  status: string
  patientIds: string[]
}

type Status = 'loading' | 'anonymous' | 'signedIn'

interface AuthContextValue {
  status: Status
  user: User | null
  signIn(email: string, password: string): Promise<User>
  signUp(input: { name: string; email: string; password: string; role: 'CAREGIVER' | 'DOCTOR' }): Promise<RegisterResult>
  signOut(): Promise<void>
  /** Ask the server again who this is, e.g. after adding a patient. */
  reload(): Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

function toUser(s: AuthSession): User {
  return { id: s.userId, name: s.name, role: s.role, status: s.status, patientIds: s.patientIds }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>('loading')
  const [user, setUser] = useState<User | null>(null)

  useEffect(() => {
    let alive = true
    // A paired tablet has no person and no cookie. Do not ask.
    if (getDeviceToken()) {
      setStatus('anonymous')
      return
    }
    void refreshSession().then((session) => {
      if (!alive) return
      if (session) {
        setUser(toUser(session))
        setStatus('signedIn')
      } else {
        setStatus('anonymous')
      }
    })
    return () => {
      alive = false
    }
  }, [])

  const signIn = useCallback(async (email: string, password: string) => {
    const u = toUser(await authApi.login(email, password))
    setUser(u)
    setStatus('signedIn')
    return u
  }, [])

  const signUp = useCallback(async (input: { name: string; email: string; password: string; role: 'CAREGIVER' | 'DOCTOR' }) => {
    const result = await authApi.register(input)
    if (result.session) {
      setUser(toUser(result.session))
      setStatus('signedIn')
    }
    return result
  }, [])

  const signOut = useCallback(async () => {
    try {
      await authApi.logout()
    } finally {
      setUser(null)
      setStatus('anonymous')
    }
  }, [])

  const reload = useCallback(async () => {
    const me = await authApi.me()
    setUser((u) => (u ? { ...u, name: me.name, role: me.role, status: me.status, patientIds: me.patientIds } : u))
  }, [])

  const value = useMemo(() => ({ status, user, signIn, signUp, signOut, reload }), [status, user, signIn, signUp, signOut, reload])
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>')
  return ctx
}

/** Where each kind of person starts. */
export function homeFor(role: UserRole): string {
  switch (role) {
    case 'DOCTOR':
      return '/doctor'
    case 'ADMIN':
      return '/admin'
    default:
      return '/caregiver/dashboard'
  }
}
