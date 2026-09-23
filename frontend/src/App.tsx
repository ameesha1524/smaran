import { Navigate, Route, Routes } from 'react-router-dom'
import Home from './screens/Home'
import Onboarding from './screens/Onboarding'
import WeaversLoom from './games/WeaversLoom'
import GrandmothersTale from './games/GrandmothersTale'
import FamilyGrove from './games/FamilyGrove'
import MorningRituals from './games/MorningRituals'
import LanguageChoice from './screens/LanguageChoice'
import PatientLogin from './screens/Login'
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
  const { onboarded, registered, languageChosen } = useSmaran()
  // Three gates, each asked exactly once: which language (a flower), who is
  // sitting down (a name), and the arrival that builds the profile. After
  // that this route is the pond and nothing else.
  if (!languageChosen) return <Navigate to="/language" replace />
  if (!registered) return <Navigate to="/login" replace />
  return onboarded ? <Home /> : <Navigate to="/welcome" replace />
}

export default function App() {
  return (
    <SmaranProvider>
      <Routes>
        <Route path="/" element={<PatientEntry />} />
        <Route path="/language" element={<LanguageChoice />} />
        <Route path="/login" element={<PatientLogin />} />
        <Route path="/welcome" element={<Onboarding />} />

        <Route path="/game/weavers-loom" element={<WeaversLoom />} />
        <Route path="/game/grandmothers-tale" element={<GrandmothersTale />} />
        <Route path="/game/family-grove" element={<FamilyGrove />} />
        <Route path="/game/morning-rituals" element={<MorningRituals />} />

        <Route path="/caregiver" element={<Login />} />
        <Route path="/caregiver/dashboard" element={<Dashboard />} />
        <Route path="/caregiver/setup" element={<Setup />} />

        {/* Anything unrecognised returns her to the pond rather than a 404. */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </SmaranProvider>
  )
}
