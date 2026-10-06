package org.smaran.scoring;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.smaran.domain.DomainReading;
import org.smaran.scoring.Contract.AlertRule;
import org.smaran.scoring.Contract.AlertSeverity;
import org.smaran.scoring.Contract.Reading;
import org.smaran.scoring.Contract.TargetState;
import org.smaran.service.CognitiveMap;

/** The service around the engine: seeding, storage, and the one-path promise. */
class CognitiveScoringServiceTest {

    private final CognitiveScoringService service =
            new CognitiveScoringService(new ObjectMapper(), AlertRule.TWO_CONSECUTIVE, 0.5, 4);

    private static Map<String, Double> scores(double value) {
        Map<String, Double> m = new LinkedHashMap<>();
        for (String d : CognitiveMap.DOMAINS) {
            m.put(d, value);
        }
        return m;
    }

    @Test
    @DisplayName("a profile that predates the engine keeps its levels: 0.6 → 0.7, as before")
    void legacyProfile() {
        var applied = service.apply(null, scores(0.6), Map.of("motor", new DomainReading(1, 1)));
        assertEquals(0.7, applied.domainScores().get("motor"));
        assertEquals(70, applied.state().get("MOTOR").level(), 1e-12);
    }

    @Test
    @DisplayName("a new profile starts at 50")
    void newProfile() {
        var applied = service.apply(null, scores(CognitiveMap.NEUTRAL), Map.of("motor", new DomainReading(1, 1)));
        assertEquals(62.5, applied.state().get("MOTOR").level(), 1e-12);
        assertEquals(0.625, applied.domainScores().get("motor"));
    }

    @Test
    @DisplayName("one session changes the profile exactly once, and only the domains it read")
    void exactlyOnce() {
        Map<String, DomainReading> frog = new LinkedHashMap<>();
        frog.put("visualSemantic", new DomainReading(0.8, 0.9));
        frog.put("motor", new DomainReading(0.7, 0.8));
        var applied = service.apply(null, scores(0.5), frog);

        assertEquals(2, applied.readings().size());
        assertEquals(1, applied.state().get("VISUAL_SEMANTIC").observations());
        assertEquals(1, applied.state().get("MOTOR").observations());
        assertEquals(0, applied.state().get("LANGUAGE").observations());
        assertEquals(0.5, applied.domainScores().get("language"));
        assertEquals(50 * (1 - 0.225) + 80 * 0.225, applied.state().get("VISUAL_SEMANTIC").level(), 1e-12);
    }

    @Test
    @DisplayName("state written by one call is read back unchanged by the next")
    void roundTrip() {
        var first = service.apply(null, scores(0.5), Map.of("motor", new DomainReading(0.8, 1)));
        String stored = service.write(first.state());
        var second = service.apply(stored, first.domainScores(), Map.of("motor", new DomainReading(0.6, 1)));

        TargetState motor = second.state().get("MOTOR");
        assertEquals(2, motor.observations());
        assertEquals(List.of(80.0, 60.0), motor.raws());
    }

    @Test
    @DisplayName("a corrupt stored state is reseeded from the levels instead of failing the submit")
    void corruptState() {
        var applied = service.apply("{not json", scores(0.6), Map.of("motor", new DomainReading(1, 1)));
        assertEquals(0.7, applied.domainScores().get("motor"));
    }

    @Test
    @DisplayName("a domain the stored state has never held is seeded from its score")
    void missingDomain() {
        String stored = service.write(Map.of("MOTOR", new TargetState(64, 3, List.of(60.0, 62.0, 70.0), 0, 0, 0)));
        var applied = service.apply(stored, scores(0.6), Map.of("executiveFunction", new DomainReading(1, 1)));
        assertEquals(0.7, applied.domainScores().get("executiveFunction"));
        assertEquals(3, applied.state().get("MOTOR").observations());
    }

    @Test
    @DisplayName("the default rule alerts on the second low reading, not the first")
    void twoConsecutive() {
        String stored = null;
        Map<String, Double> current = scores(0.5);
        Reading last = null;
        double[] raws = {0.70, 0.71, 0.69, 0.70, 0.72, 0.68, 0.70, 0.71, 0.69, 0.70, 0.71, 0.70, 0.45};
        for (double raw : raws) {
            var applied = service.apply(stored, current, Map.of("motor", new DomainReading(raw, 1)));
            stored = service.write(applied.state());
            current = applied.domainScores();
            last = applied.readings().get(0);
        }
        assertEquals("decline", last.status().label());
        assertNull(last.alert());

        var next = service.apply(stored, current, Map.of("motor", new DomainReading(0.46, 1)));
        assertEquals(AlertSeverity.DECLINE, next.readings().get(0).alert());
    }
}
