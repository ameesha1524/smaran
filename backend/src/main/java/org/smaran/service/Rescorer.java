package org.smaran.service;

import com.fasterxml.jackson.core.type.TypeReference;
import io.micrometer.core.instrument.Counter;
import io.micrometer.core.instrument.MeterRegistry;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import lombok.extern.slf4j.Slf4j;
import org.smaran.domain.GameSession;
import org.smaran.scoring.Contract.ScoreContribution;
import org.smaran.scoring.DuckRollCallScoring;
import org.springframework.stereotype.Component;

/**
 * The server scoring a session again, from its raw trials, and comparing.
 *
 * A tablet computes its own scores so that the profile on the glass and the one
 * on the server agree offline. That makes the server's copy only as honest as
 * the tablet. For a game whose raw trials the server understands, this class
 * recomputes the contributions with the Java twin of the game's scoring and
 * compares:
 *
 * <ul>
 *   <li>agreement: the session is marked {@code scoring_trust = server}, and
 *       {@code scoring_rescored_total} counts it;</li>
 *   <li>disagreement: the stored scores stay the tablet's, the session stays
 *       {@code device}, a warning is logged, and {@code scoring_mismatch_total}
 *       counts it. A rising mismatch count means the two implementations have
 *       drifted apart, or a tablet is reporting something its trials do not.</li>
 * </ul>
 *
 * Today that is Duck Roll Call. Adding a game here is one {@code case}.
 */
@Component
@Slf4j
public class Rescorer {

    /** Raw scores agree if they differ by no more than this (the tablet rounds to one decimal). */
    static final double RAW_TOLERANCE = 0.5;
    static final double CONFIDENCE_TOLERANCE = 0.01;

    private final SessionRecords records;
    private final Counter rescored;
    private final Counter mismatched;

    public Rescorer(SessionRecords records, MeterRegistry meters) {
        this.records = records;
        this.rescored = Counter.builder("scoring_rescored_total")
                .description("Sessions the server re-scored from raw trials and agreed with")
                .register(meters);
        this.mismatched = Counter.builder("scoring_mismatch_total")
                .description("Sessions whose device-computed scores the server could not reproduce")
                .register(meters);
    }

    /** Re-score the session if the server can, and record the result on it. */
    public void check(GameSession session) {
        List<ScoreContribution> mine = rescore(session);
        if (mine == null) {
            return;
        }
        List<ScoreContribution> theirs = records.contributionsOf(session, Map.of());
        if (agree(mine, theirs)) {
            session.setScoringTrust("server");
            rescored.increment();
        } else {
            mismatched.increment();
            log.warn("session {} ({}): the server's scores differ from the tablet's: server {} / tablet {}",
                    session.getId(), session.getGameId(), brief(mine), brief(theirs));
        }
    }

    /** The server's contributions for this session, or null if it cannot score this game. */
    List<ScoreContribution> rescore(GameSession session) {
        if (session.getGameId() == null || session.getTrials() == null) {
            return null;
        }
        return switch (session.getGameId()) {
            case "duck-roll-call" -> {
                List<Object> trials = records.read(session.getTrials(), new TypeReference<List<Object>>() { }, null);
                yield trials == null ? null : DuckRollCallScoring.score(trials);
            }
            default -> null;
        };
    }

    static boolean agree(List<ScoreContribution> server, List<ScoreContribution> device) {
        if (server.size() != device.size()) {
            return false;
        }
        for (ScoreContribution s : server) {
            ScoreContribution d = device.stream().filter(x -> x.target().equals(s.target())).findFirst().orElse(null);
            if (d == null
                    || Math.abs(d.raw() - s.raw()) > RAW_TOLERANCE
                    || Math.abs(d.confidence() - s.confidence()) > CONFIDENCE_TOLERANCE) {
                return false;
            }
        }
        return true;
    }

    private static String brief(List<ScoreContribution> cs) {
        List<String> out = new ArrayList<>();
        for (ScoreContribution c : cs) {
            out.add("%s=%.1f@%.2f".formatted(c.target(), c.raw(), c.confidence()));
        }
        return out.toString();
    }
}
