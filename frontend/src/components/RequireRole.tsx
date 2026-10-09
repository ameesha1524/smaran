import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { homeFor, useAuth } from '../lib/auth'
import type { UserRole } from '../lib/api'

/**
 * Sends people to the right door. Presentation only: the server refuses what a
 * role may not do whether or not this component is there.
 *
 *   not signed in      → the sign-in screen, remembering where they were going
 *   wrong kind of user → their own home
 */
export default function RequireRole({ roles, children }: { roles: UserRole[]; children: ReactNode }) {
  const { status, user } = useAuth()
  const location = useLocation()

  if (status === 'loading') {
    return (
      <div className="flex min-h-screen items-center justify-center" style={{ color: 'var(--chalk-dim)' }} role="status">
        One moment…
      </div>
    )
  }
  if (!user) {
    return <Navigate to="/caregiver/login" replace state={{ from: location.pathname }} />
  }
  if (!roles.includes(user.role)) {
    return <Navigate to={homeFor(user.role)} replace />
  }
  return <>{children}</>
}
