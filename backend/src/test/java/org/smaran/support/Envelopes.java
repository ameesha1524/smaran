package org.smaran.support;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.smaran.scoring.Contract;
import org.smaran.scoring.Contract.ScoreContribution;
import org.smaran.scoring.Contract.SessionEnvelope;
import org.smaran.scoring.Contract.SessionMarkers;

/** Sessions as a tablet would send them, for tests. */
public final class Envelopes {

    private Envelopes() {
    }

    public static ScoreContribution c(String target, double raw, double confidence) {
        return new ScoreContribution(target, raw, confidence, "synthetic");
    }

    /** A session of {@code gameId} at {@code at}, finished, with these contributions. */
    public static SessionEnvelope of(String patientId, String gameId, Instant at, ScoreContribution... cs) {
        return new SessionEnvelope(
                UUID.randomUUID().toString(),
                patientId,
                gameId,
                at.toString(),
                60_000,
                true,
                false,
                9,
                "QUIET",
                new Contract.Difficulty(1, Map.of("span", 3)),
                List.of(Map.of("round", 1)),
                List.of(cs),
                null,
                false,
                Contract.ENGINE_VERSION);
    }

    /** A Koi Are Jumping session reading MOTOR at {@code motor} (0 to 100), full confidence. */
    public static SessionEnvelope koi(String patientId, Instant at, double motor) {
        return of(patientId, "koi-are-jumping", at, c("MOTOR", motor, 1));
    }

    public static SessionEnvelope withMarkers(SessionEnvelope e, SessionMarkers markers) {
        return new SessionEnvelope(
                e.clientSessionId(), e.patientId(), e.gameId(), e.startedAt(), e.durationMs(), e.completed(),
                e.abandoned(), e.hourOfDay(), e.moodAtStart(), e.difficulty(), e.trials(), e.contributions(), markers,
                e.precomputedReading(), e.engineVersion());
    }

    public static SessionEnvelope withTrials(SessionEnvelope e, List<Object> trials) {
        return new SessionEnvelope(
                e.clientSessionId(), e.patientId(), e.gameId(), e.startedAt(), e.durationMs(), e.completed(),
                e.abandoned(), e.hourOfDay(), e.moodAtStart(), e.difficulty(), trials, e.contributions(), e.markers(),
                e.precomputedReading(), e.engineVersion());
    }
}
