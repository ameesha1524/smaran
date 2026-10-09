package org.smaran;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.Map;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.smaran.config.DemoDataSeeder;
import org.smaran.domain.CognitiveProfile;
import org.smaran.repo.GameSessionRepository;
import org.smaran.scoring.Contract.TargetState;
import org.smaran.service.CognitiveProfileService;
import org.smaran.support.PostgresIntegrationTest;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.context.ActiveProfiles;

/**
 * The demo profile on a real PostgreSQL: the synthetic history seeds without
 * breaking a constraint, and the demo patient's profile is what the scoring
 * engine makes of that history.
 */
@ActiveProfiles({"test", "demo"})
class DemoSeedIT extends PostgresIntegrationTest {

    @Autowired
    GameSessionRepository sessions;

    @Autowired
    CognitiveProfileService profiles;

    @Test
    @DisplayName("every seeded session went through the engine, once")
    void seededHistoryIsScored() {
        long stored = sessions.countByPatientId(DemoDataSeeder.PATIENT_ID);
        assertTrue(stored >= 20, "expected about a month of sessions, found " + stored);

        CognitiveProfile profile = profiles.forPatient(DemoDataSeeder.PATIENT_ID);
        Map<String, TargetState> state = profiles.scoringState(profile);

        // Each of the six games reads its own domain, so each has history.
        for (String domain : new String[] {"LANGUAGE", "VISUAL_SEMANTIC", "MOTOR", "AFFECTIVE", "TEMPORAL", "EXECUTIVE"}) {
            assertTrue(state.get(domain).observations() > 0, domain + " has no observations");
        }

        // One observation per reading: single-domain sessions give one, a pond
        // visit gives four. Counted from the stored sessions, not assumed.
        long readings = sessions.findAll().stream()
                .filter(s -> DemoDataSeeder.PATIENT_ID.equals(s.getPatientId()))
                .mapToLong(s -> profiles.readingsOf(s).size())
                .sum();
        // Sub-signals (working-memory span) are counted beside the domains, not among them.
        long observations = java.util.stream.Stream.of("LANGUAGE", "VISUAL_SEMANTIC", "MOTOR", "AFFECTIVE", "TEMPORAL", "EXECUTIVE")
                .mapToLong(d -> state.get(d).observations()).sum();
        assertEquals(readings, observations);
    }

    @Test
    @DisplayName("the 0-1 domain scores are the engine levels divided by 100")
    void scoresAreAViewOfTheLevels() {
        CognitiveProfile profile = profiles.forPatient(DemoDataSeeder.PATIENT_ID);
        Map<String, TargetState> state = profiles.scoringState(profile);
        Map<String, Double> scores = profiles.scores(profile);
        assertEquals(state.get("MOTOR").level() / 100, scores.get("motor"), 0.0006);
        assertEquals(state.get("VISUAL_SEMANTIC").level() / 100, scores.get("visualSemantic"), 0.0006);
    }
}
