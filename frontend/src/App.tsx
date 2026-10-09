import { Navigate, Route, Routes } from 'react-router-dom'
import Home from './screens/Home'
import GamesMenu from './screens/GamesMenu'
import DuckRollCall from './games/DuckRollCall'
import GrandmothersTale from './games/GrandmothersTale'
import FamilyGrove from './games/FamilyGrove'
import MorningRituals from './games/MorningRituals'
import LotusFrog from './games/LotusFrog'
import KoiAreJumping from './games/KoiAreJumping'
import LanguageChoice from './screens/LanguageChoice'
import Journal from './screens/Journal'
import Login from './caregiver/Login'
import Dashboard from './caregiver/Dashboard'
import Register from './caregiver/Register'
import CreatePatient from './caregiver/CreatePatient'
import DoctorHome from './caregiver/DoctorHome'
import AdminHome from './caregiver/AdminHome'
import RequireRole from './components/RequireRole'
import { AuthProvider, homeFor, useAuth } from './lib/auth'
import Setup from './caregiver/Setup'
import PairDevice from './caregiver/PairDevice'
import { SmaranProvider, useSmaran } from './state/SmaranContext'

/**
 * Routing.
 *
 * The patient's half of the app has four game routes and one home, and home is
 * always one tap away from anywhere. The caregiver's half lives behind /caregiver
 * and looks and behaves like a different kind of software, because it is.
 */

function PatientEntry() {
  const { caregiverSetupComplete, languageConfirmed } = useSmaran()
  // Two gates, and neither belongs to the patient for long. The family sets the
  // device up — by pairing it with their account, or locally with no account —
  // and she confirms the language once. After that this route is the pond,
  // unconditionally — no login, no onboarding screen, no mood gate. What used
  // to be onboarding is now the first two sessions, observed silently.
  if (!caregiverSetupComplete) return <Navigate to="/caregiver/pair" replace />
  if (!languageConfirmed) return <Navigate to="/language" replace />
  return <Home />
}

/** The old /caregiver address: send people to the right place for who they are. */
function CaregiverEntry() {
  const { status, user } = useAuth()
  if (status === 'loading') return null
  return <Navigate to={user ? homeFor(user.role) : '/caregiver/login'} replace />
}

export default function App() {
  return (
    <AuthProvider>
    <SmaranProvider>
      <Routes>
        <Route path="/" element={<PatientEntry />} />
        <Route path="/language" element={<LanguageChoice />} />
        <Route path="/journal" element={<Journal />} />
        <Route path="/games" element={<GamesMenu />} />
        {/* Bypasses the gates so the pond can be screenshotted headlessly. */}
        <Route path="/preview-home" element={<Home />} />

        <Route path="/game/duck-roll-call" element={<DuckRollCall />} />
        <Route path="/game/grandmothers-tale" element={<GrandmothersTale />} />
        <Route path="/game/family-grove" element={<FamilyGrove />} />
        <Route path="/game/morning-rituals" element={<MorningRituals />} />
        <Route path="/game/lotus-frog" element={<LotusFrog />} />
        <Route path="/game/koi-are-jumping" element={<KoiAreJumping />} />

        <Route path="/caregiver" element={<CaregiverEntry />} />
        <Route path="/caregiver/login" element={<Login />} />
        <Route path="/caregiver/register" element={<Register />} />
        <Route
          path="/caregiver/dashboard/:patientId?"
          element={
            <RequireRole roles={['CAREGIVER', 'ADMIN']}>
              <Dashboard />
            </RequireRole>
          }
        />
        <Route
          path="/caregiver/patients/new"
          element={
            <RequireRole roles={['CAREGIVER']}>
              <CreatePatient />
            </RequireRole>
          }
        />
        {/* Sample data for a screen to look at with no server. Development builds only. */}
        {import.meta.env.DEV && <Route path="/caregiver/demo" element={<Dashboard demo />} />}
        <Route path="/caregiver/setup" element={<Setup />} />

        <Route
          path="/doctor"
          element={
            <RequireRole roles={['DOCTOR']}>
              <DoctorHome />
            </RequireRole>
          }
        />
        <Route
          path="/doctor/patient/:patientId"
          element={
            <RequireRole roles={['DOCTOR']}>
              <Dashboard />
            </RequireRole>
          }
        />
        <Route
          path="/admin"
          element={
            <RequireRole roles={['ADMIN']}>
              <AdminHome />
            </RequireRole>
          }
        />
        <Route path="/caregiver/pair" element={<PairDevice />} />

        {/* Anything unrecognised returns her to the pond rather than a 404. */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </SmaranProvider>
    </AuthProvider>
  )
}
