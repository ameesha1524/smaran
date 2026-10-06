package org.smaran.scoring;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.smaran.domain.DomainReading;
import org.smaran.scoring.Contract.ScoreContribution;
import org.smaran.scoring.Contract.TargetState;

/**
 * The bridge between the engine (0–100, {@code LANGUAGE}…{@code EXECUTIVE})
 * and the shapes the rest of the server still speaks (0–1,
 * {@code language}…{@code executiveFunction}).
 *
 * Sessions currently arrive carrying 0–1 domain readings. Those become
 * contributions here, go through the engine, and the engine's levels are
 * projected back to the profile's domain scores for routing, the dashboard and
 * the report. The engine state is the truth; the domain scores are a view.
 *
 * Mirror of frontend/src/lib/scoring/legacy.ts.
 */
public final class LegacyScores {

    private LegacyScores() {
    }

    /** Legacy domain name → engine id, in the fixed domain order. */
    public static final Map<String, String> DOMAIN_ID_OF;

    static {
        Map<String, String> m = new LinkedHashMap<>();
        m.put("language", "LANGUAGE");
        m.put("visualSemantic", "VISUAL_SEMANTIC");
        m.put("motor", "MOTOR");
        m.put("affective", "AFFECTIVE");
        m.put("temporal", "TEMPORAL");
        m.put("executiveFunction", "EXECUTIVE");
        DOMAIN_ID_OF = java.util.Collections.unmodifiableMap(m);
    }

    /** 0–1 readings → engine contributions, in the fixed domain order. */
    public static List<ScoreContribution> contributionsFrom(Map<String, DomainReading> readings) {
        List<ScoreContribution> out = new ArrayList<>();
        if (readings == null) {
            return out;
        }
        DOMAIN_ID_OF.forEach((legacy, id) -> {
            DomainReading r = readings.get(legacy);
            if (r != null) {
                out.add(new ScoreContribution(id, r.score() * 100, r.confidence(), ""));
            }
        });
        return out;
    }

    /**
     * Seed an engine state from a profile saved before the engine existed.
     * Each level carries over; there is no history, so observations start at
     * zero and the domain has to earn its confidence again.
     */
    public static Map<String, TargetState> stateFrom(Map<String, Double> scores, ScoringConfig config) {
        Map<String, TargetState> state = new LinkedHashMap<>();
        if (scores == null) {
            return state;
        }
        DOMAIN_ID_OF.forEach((legacy, id) -> {
            Double score = scores.get(legacy);
            if (score != null && Double.isFinite(score)) {
                double level = Math.max(0, Math.min(1, score)) * 100;
                state.put(id, new TargetState(level, 0, List.of(), 0, 0, 0));
            }
        });
        return state;
    }

    /** Engine levels → 0–1 domain scores. Domains the engine has not seen keep their previous value. */
    public static Map<String, Double> domainScoresFrom(Map<String, TargetState> state, Map<String, Double> previous) {
        Map<String, Double> next = new LinkedHashMap<>(previous != null ? previous : Map.of());
        DOMAIN_ID_OF.forEach((legacy, id) -> {
            TargetState target = state.get(id);
            if (target != null) {
                next.put(legacy, Math.round(target.level() * 10d) / 1000d);
            }
        });
        return next;
    }
}
