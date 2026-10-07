package org.smaran.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.time.Duration;
import java.time.Instant;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.smaran.domain.DomainReading;
import org.smaran.domain.Enums.GameType;

/**
 * The cognitive map's promises, as tests — and the parity vectors written at
 * the bottom of frontend/src/lib/cognitiveMap.ts, asserted to the same numbers.
 * If one of these changes, the TypeScript copy must change with it.
 */
class CognitiveMapTest {

    private static Map<String, Double> neutral() {
        Map<String, Double> m = new LinkedHashMap<>();
        for (String d : CognitiveMap.DOMAINS) {
            m.put(d, 0.6);
        }
        return m;
    }

    /* -------------------------------------------------------- parity */

    @Test
    @DisplayName("parity: full confidence is exactly the old 0.75/0.25 rule")
    void fullConfidence() {
        var next = CognitiveMap.apply(neutral(), Map.of("motor", new DomainReading(1, 1)));
        assertEquals(0.7, next.get("motor"));
    }

    @Test
    @DisplayName("parity: half confidence moves half as far")
    void halfConfidence() {
        var next = CognitiveMap.apply(neutral(), Map.of("motor", new DomainReading(1, 0.5)));
        assertEquals(0.65, next.get("motor"));
    }

    @Test
    @DisplayName("parity: a zero score at full confidence")
    void zeroScore() {
        var next = CognitiveMap.apply(neutral(), Map.of("motor", new DomainReading(0, 1)));
        assertEquals(0.45, next.get("motor"));
    }

    @Test
    @DisplayName("parity: a game with no readings reads completion rate against its primary domain")
    void defaultReading() {
        var r = CognitiveMap.readingsFor(GameType.FAMILY_GROVE, 0.8, null);
        assertEquals(Map.of("affective", new DomainReading(0.8, 1)), r);
    }

    @Test
    @DisplayName("parity: out-of-range readings are clamped, not trusted")
    void clamped() {
        var r = CognitiveMap.sanitize(Map.of("motor", new DomainReading(1.4, 2)));
        assertEquals(new DomainReading(1, 1), r.get("motor"));
    }

    /* -------------------------------------------------------- update */

    @Test
    @DisplayName("domains a session did not read are left exactly as they were")
    void untouched() {
        var before = neutral();
        before.put("language", 0.83);
        var next = CognitiveMap.apply(before, Map.of("motor", new DomainReading(1, 1)));
        assertEquals(0.83, next.get("language"));
        assertEquals(0.6, next.get("executiveFunction"));
    }

    @Test
    @DisplayName("a domain the profile has never held starts from neutral, not zero")
    void missingPrior() {
        Map<String, Double> old = new HashMap<>(neutral());
        old.remove("executiveFunction"); // a profile stored before Domain 6 existed
        var next = CognitiveMap.apply(old, Map.of("executiveFunction", new DomainReading(1, 1)));
        assertEquals(0.7, next.get("executiveFunction"));
    }

    @Test
    @DisplayName("unknown domains, non-finite numbers and zero confidence are dropped")
    void sanitize() {
        Map<String, DomainReading> in = new HashMap<>();
        in.put("memory", new DomainReading(0.9, 1));
        in.put("motor", new DomainReading(Double.NaN, 1));
        in.put("language", new DomainReading(0.9, 0));
        in.put("temporal", new DomainReading(0.4, 0.5));
        assertEquals(Map.of("temporal", new DomainReading(0.4, 0.5)), CognitiveMap.sanitize(in));
    }

    @Test
    @DisplayName("a game's own readings replace the completion-rate default")
    void ownReadingsWin() {
        var frog = Map.of(
                "visualSemantic", new DomainReading(0.8, 0.9),
                "affective", new DomainReading(0.7, 0.4));
        var r = CognitiveMap.readingsFor(GameType.LOTUS_FROG, 0.1, frog);
        assertEquals(2, r.size());
        assertEquals(0.8, r.get("visualSemantic").score());
    }

    @Test
    @DisplayName("the retired Weaver's Loom still maps its stored sessions to visual-semantic")
    @SuppressWarnings("deprecation")
    void retiredGame() {
        assertEquals("visualSemantic", CognitiveMap.primaryDomain(GameType.WEAVERS_LOOM));
        assertFalse(CognitiveMap.ROUTE_GAMES.contains(GameType.WEAVERS_LOOM));
    }

    /* -------------------------------------------------------- tables */

    @Test
    @DisplayName("every domain has a game, and every routed game reads its domain")
    void tablesAgree() {
        for (String d : CognitiveMap.DOMAINS) {
            GameType g = CognitiveMap.DOMAIN_GAME.get(d);
            assertNotNull(g, d);
            assertEquals(d, CognitiveMap.primaryDomain(g));
            assertTrue(CognitiveMap.ROUTE_GAMES.contains(g), g.name());
        }
        for (GameType g : CognitiveMap.ROUTE_GAMES) {
            assertNotNull(CognitiveMap.primaryDomain(g), g.name());
        }
        assertTrue(CognitiveMap.ROUTE_GAMES.containsAll(CognitiveMap.LOW_EFFORT));
        assertTrue(CognitiveMap.ROUTE_GAMES.containsAll(CognitiveMap.TIMING_GAMES));
    }

    /* ------------------------------------------------ weakest domain */

    private static CognitiveMap.Dated at(Instant t, String domain, double score) {
        return new CognitiveMap.Dated(t, Map.of(domain, new DomainReading(score, 1)));
    }

    @Test
    @DisplayName("fewer than three sessions this week says nothing")
    void tooFew() {
        Instant now = Instant.now();
        var h = List.of(at(now.minusSeconds(100), "motor", 0.9), at(now.minusSeconds(50), "motor", 0.2));
        assertEquals(Optional.empty(), CognitiveMap.weakestDomain(h, now));
    }

    @Test
    @DisplayName("the steepest fall wins, and a hold is not a fall")
    void steepestFall() {
        Instant now = Instant.now();
        var h = List.of(
                at(now.minus(Duration.ofDays(5)), "motor", 0.8),
                at(now.minus(Duration.ofDays(4)), "language", 0.8),
                at(now.minus(Duration.ofDays(3)), "motor", 0.7),
                at(now.minus(Duration.ofDays(2)), "language", 0.5),
                at(now.minus(Duration.ofDays(1)), "temporal", 0.6));
        assertEquals(Optional.of("language"), CognitiveMap.weakestDomain(h, now));

        var holding = List.of(
                at(now.minus(Duration.ofDays(3)), "motor", 0.8),
                at(now.minus(Duration.ofDays(2)), "motor", 0.77),
                at(now.minus(Duration.ofDays(1)), "motor", 0.79));
        assertEquals(Optional.empty(), CognitiveMap.weakestDomain(holding, now));
    }

    @Test
    @DisplayName("a multi-domain session counts toward each domain it read")
    void multiDomain() {
        Instant now = Instant.now();
        var h = List.of(
                new CognitiveMap.Dated(now.minus(Duration.ofDays(3)), Map.of(
                        "visualSemantic", new DomainReading(0.9, 0.9), "motor", new DomainReading(0.7, 0.8))),
                at(now.minus(Duration.ofDays(2)), "affective", 0.7),
                new CognitiveMap.Dated(now.minus(Duration.ofDays(1)), Map.of(
                        "visualSemantic", new DomainReading(0.6, 0.9), "motor", new DomainReading(0.72, 0.8))));
        assertEquals(Optional.of("visualSemantic"), CognitiveMap.weakestDomain(h, now));
    }

    @Test
    @DisplayName("sessions older than a week are outside the window")
    void window() {
        Instant now = Instant.now();
        var h = List.of(
                at(now.minus(Duration.ofDays(10)), "motor", 0.9),
                at(now.minus(Duration.ofDays(3)), "motor", 0.6),
                at(now.minus(Duration.ofDays(2)), "affective", 0.7),
                at(now.minus(Duration.ofDays(1)), "motor", 0.6));
        assertEquals(Optional.empty(), CognitiveMap.weakestDomain(h, now));
    }
}
