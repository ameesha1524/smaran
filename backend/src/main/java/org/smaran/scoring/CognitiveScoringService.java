package org.smaran.scoring;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import lombok.extern.slf4j.Slf4j;
import org.smaran.domain.DomainReading;
import org.smaran.scoring.Contract.AlertRule;
import org.smaran.scoring.Contract.Reading;
import org.smaran.scoring.Contract.ScoreContribution;
import org.smaran.scoring.Contract.TargetState;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

/**
 * The server's single scoring path.
 *
 * Wraps {@link ScoringEngine} with the two things a pure engine cannot own:
 * the configured alert rule, and reading and writing the engine state that is
 * stored on a patient's profile. Every session, from every game, reaches the
 * profile through {@link #apply}; nothing else moves a domain level.
 *
 * The device runs the same engine (frontend/src/lib/scoring) on the same
 * contributions, so the two profiles agree. Lotus Frog is not special here:
 * its readings arrive precomputed by the game, and are folded in exactly once
 * like any other.
 */
@Service
@Slf4j
public class CognitiveScoringService {

    private static final TypeReference<LinkedHashMap<String, TargetState>> STATE = new TypeReference<>() {
    };

    private final ObjectMapper json;
    private final ScoringConfig config;

    public CognitiveScoringService(
            ObjectMapper json,
            @Value("${smaran.scoring.alert-rule:TWO_CONSECUTIVE}") AlertRule alertRule,
            @Value("${smaran.scoring.cusum-k:0.5}") double cusumK,
            @Value("${smaran.scoring.cusum-h:4}") double cusumH) {
        this.json = json;
        this.config = ScoringConfig.DEFAULT.withAlertRule(alertRule, cusumK, cusumH);
    }

    public ScoringConfig config() {
        return config;
    }

    /** What one session did to a profile. */
    public record Applied(Map<String, TargetState> state, Map<String, Double> domainScores, List<Reading> readings) {
    }

    /**
     * Fold one session's readings into a profile.
     *
     * @param storedState the profile's engine state as stored, or null for a profile that predates the engine
     * @param domainScores the profile's 0–1 scores, used to seed any domain the stored state lacks
     * @param readings the session's sanitised 0–1 readings
     */
    public Applied apply(String storedState, Map<String, Double> domainScores, Map<String, DomainReading> readings) {
        Map<String, TargetState> state = stateOf(storedState, domainScores);
        List<ScoreContribution> contributions = LegacyScores.contributionsFrom(readings);
        ScoringEngine.SessionResult result = ScoringEngine.applySession(state, contributions, config);
        return new Applied(result.state(), LegacyScores.domainScoresFrom(result.state(), domainScores), result.readings());
    }

    /**
     * Fold one session's contributions into a profile. The same as {@link #apply}
     * for a session that arrives with its contributions already made.
     */
    public Applied applyContributions(
            String storedState, Map<String, Double> domainScores, List<ScoreContribution> contributions) {
        Map<String, TargetState> state = stateOf(storedState, domainScores);
        ScoringEngine.SessionResult result = ScoringEngine.applySession(state, contributions, config);
        return new Applied(result.state(), LegacyScores.domainScoresFrom(result.state(), domainScores), result.readings());
    }

    /**
     * The engine state behind a profile. A profile saved before the engine
     * existed has only 0–1 scores; each becomes a level with no history, and
     * any domain the stored state is missing is seeded the same way.
     */
    public Map<String, TargetState> stateOf(String storedState, Map<String, Double> domainScores) {
        Map<String, TargetState> state = LegacyScores.stateFrom(domainScores, config);
        state.putAll(read(storedState));
        return state;
    }

    public String write(Map<String, TargetState> state) {
        try {
            return json.writeValueAsString(state);
        } catch (Exception e) {
            throw new IllegalStateException("could not serialise scoring state", e);
        }
    }

    private Map<String, TargetState> read(String raw) {
        if (raw == null || raw.isBlank()) {
            return Map.of();
        }
        try {
            return json.readValue(raw, STATE);
        } catch (Exception e) {
            // A corrupt state is rebuilt from the levels rather than failing a
            // session submit; the history it held is lost, and that is logged.
            log.warn("unreadable scoring state, reseeding from domain scores: {}", e.getMessage());
            return Map.of();
        }
    }
}
