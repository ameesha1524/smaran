import { Navigate, Route, Routes } from 'react-router-dom'
import Home from './screens/Home'
import GamesMenu from './screens/GamesMenu'
import DuckRollCall from './games/DuckRollCall'
import GrandmothersTale from './games/GrandmothersTale'
import FamilyGrove from './games/FamilyGrove'
import MorningRituals from './games/MorningRituals'
import LotusFrog from './games/LotusFrog'
import LanguageChoice from './screens/LanguageChoice'
import Journal from './screens/Journal'
import Login from './caregiver/Login'
import Dashboard from './caregiver/Dashboard'
import Setup from './caregiver/Setup'
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
  // Two gates, and neither belongs to the patient for long. The caregiver sets
  // the device up; she confirms the language once. After that this route is the
  // pond, unconditionally — no login, no onboarding screen, no mood gate. What
  // used to be onboarding is now the first two sessions, observed silently.
  if (!caregiverSetupComplete) return <Navigate to="/caregiver/setup" replace />
  if (!languageConfirmed) return <Navigate to="/language" replace />
  return <Home />
}

export default function App() {
  return (
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

        <Route path="/caregiver" element={<Login />} />
        <Route path="/caregiver/dashboard" element={<Dashboard />} />
        <Route path="/caregiver/setup" element={<Setup />} />

        {/* Anything unrecognised returns her to the pond rather than a 404. */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </SmaranProvider>
  )
}
