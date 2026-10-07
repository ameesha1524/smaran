package org.smaran.scoring;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.smaran.scoring.Contract.AlertSeverity;
import org.smaran.scoring.Contract.Reading;
import org.smaran.scoring.Contract.ScoreContribution;
import org.smaran.scoring.Contract.Status;
import org.smaran.scoring.Contract.TargetState;

/**
 * The scoring engine. Pure functions, no clock, no storage, no randomness.
 *
 * The Java twin of frontend/src/lib/scoring/engine.ts, line for line. For each
 * contribution on a domain or sub-signal, in {@code startedAt} order:
 *
 * <pre>
 *   alpha     = baseAlpha × confidence                       (0.25 × confidence)
 *   baseline  = mean of the prior raws      (the prior level until there are 3)
 *   sd        = sample SD of the prior raws (12 until there are 5; never below 3)
 *   velocity  = (raw − baseline) / sd
 *   level'    = level × (1 − alpha) + raw × alpha            (starts at 50)
 *   domain confidence = min(1, observations / 12)
 *   status    = stable while domain confidence &lt; 0.35, otherwise from velocity
 * </pre>
 *
 * Both engines are held to golden-vectors.json (ScoringEngineGoldenTest here).
 * For the numbers to agree to the last bit, sums run oldest-first, the SD uses
 * n − 1, and nothing is rounded inside the engine.
 */
public final class ScoringEngine {

    private ScoringEngine() {
    }

    public record Step(TargetState state, Reading reading) {
    }

    public record SessionResult(Map<String, TargetState> state, List<Reading> readings) {
    }

    public static TargetState initial(ScoringConfig config) {
        return new TargetState(config.startLevel(), 0, List.of(), 0, 0, 0);
    }

    /** Apply one contribution to one target's state, or null if it carries no usable evidence. */
    public static Step applyToTarget(TargetState prior, ScoreContribution contribution, ScoringConfig config) {
        if (contribution == null || !Contract.TARGET_IDS.contains(contribution.target())) {
            return null;
        }
        if (!Double.isFinite(contribution.raw()) || !Double.isFinite(contribution.confidence())) {
            return null;
        }
        double confidence = clamp(contribution.confidence(), 0, 1);
        if (confidence <= 0) {
            return null;
        }
        double raw = clamp(contribution.raw(), 0, 100);
        TargetState before = prior != null ? prior : initial(config);
        List<Double> priorRaws = before.raws() != null ? before.raws() : List.of();

        int n = priorRaws.size();
        double baseline = n >= config.minBaselineObservations() ? mean(priorRaws) : before.level();
        double sd = n >= config.minSdObservations()
                ? Math.max(config.minSd(), sampleSd(priorRaws))
                : config.priorSd();
        double velocity = (raw - baseline) / sd;

        double alpha = config.baseAlpha() * confidence;
        double level = before.level() * (1 - alpha) + raw * alpha;
        int observations = before.observations() + 1;
        List<Double> raws = new ArrayList<>(priorRaws);
        raws.add(raw);
        if (raws.size() > config.window()) {
            raws = new ArrayList<>(raws.subList(raws.size() - config.window(), raws.size()));
        }
        double domainConfidence = Math.min(1, (double) observations / config.fullConfidenceObservations());

        boolean gated = domainConfidence < config.confidenceGate();
        Status status = gated ? Status.STABLE : statusFor(velocity, config);

        // All three rules' bookkeeping is kept on every step, so the rule can
        // be switched in config without replaying history.
        int runWatch = !gated && velocity <= config.watchVelocity() ? before.runWatch() + 1 : 0;
        int runDecline = !gated && velocity <= config.declineVelocity() ? before.runDecline() + 1 : 0;
        double cusum = gated ? 0 : Math.max(0, before.cusum() + (-velocity - config.cusumK()));

        TargetState state = new TargetState(level, observations, List.copyOf(raws), runWatch, runDecline, cusum);
        AlertSeverity alert = gated ? null : alertFor(state, velocity, config);
        return new Step(state, new Reading(
                contribution.target(), raw, confidence, level, baseline, sd, velocity, domainConfidence, status, alert));
    }

    /** Apply one session's contributions, in the order given. Unusable ones are skipped. */
    public static SessionResult applySession(
            Map<String, TargetState> state, List<ScoreContribution> contributions, ScoringConfig config) {
        Map<String, TargetState> next = new LinkedHashMap<>(state != null ? state : Map.of());
        List<Reading> readings = new ArrayList<>();
        if (contributions != null) {
            for (ScoreContribution contribution : contributions) {
                if (contribution == null) {
                    continue;
                }
                Step step = applyToTarget(next.get(contribution.target()), contribution, config);
                if (step == null) {
                    continue;
                }
                next.put(contribution.target(), step.state());
                readings.add(step.reading());
            }
        }
        return new SessionResult(next, readings);
    }

    /**
     * Rebuild a state from scratch. {@code sessions} must already be in
     * {@code startedAt} order; used when an older session arrives late.
     */
    public static Map<String, TargetState> replay(
            List<List<ScoreContribution>> sessions, ScoringConfig config, Map<String, TargetState> initial) {
        Map<String, TargetState> state = initial != null ? initial : Map.of();
        for (List<ScoreContribution> contributions : sessions) {
            state = applySession(state, contributions, config).state();
        }
        return state;
    }

    public static Status statusFor(double velocity, ScoringConfig config) {
        if (velocity <= config.declineVelocity()) {
            return Status.DECLINE;
        }
        if (velocity <= config.watchVelocity()) {
            return Status.WATCH;
        }
        if (velocity >= config.improvingVelocity()) {
            return Status.IMPROVING;
        }
        return Status.STABLE;
    }

    /**
     * Should this contribution raise an alert, under the configured rule?
     * Called only for gated-in contributions; {@code state} is the state after
     * this one.
     */
    public static AlertSeverity alertFor(TargetState state, double velocity, ScoringConfig config) {
        return switch (config.alertRule()) {
            case SINGLE -> velocity <= config.declineVelocity()
                    ? AlertSeverity.DECLINE
                    : velocity <= config.watchVelocity() ? AlertSeverity.WATCH : null;
            case TWO_CONSECUTIVE -> state.runDecline() >= 2
                    ? AlertSeverity.DECLINE
                    : state.runWatch() >= 2 ? AlertSeverity.WATCH : null;
            case CUSUM -> state.cusum() >= config.cusumH()
                    ? AlertSeverity.DECLINE
                    : state.cusum() >= config.cusumH() / 2 ? AlertSeverity.WATCH : null;
        };
    }

    /* ----------------------------------------------------------- helpers */

    static double mean(List<Double> xs) {
        double sum = 0;
        for (double x : xs) {
            sum += x;
        }
        return sum / xs.size();
    }

    /** Sample standard deviation (n − 1). */
    static double sampleSd(List<Double> xs) {
        if (xs.size() < 2) {
            return 0;
        }
        double m = mean(xs);
        double ss = 0;
        for (double x : xs) {
            ss += (x - m) * (x - m);
        }
        return Math.sqrt(ss / (xs.size() - 1));
    }

    private static double clamp(double v, double lo, double hi) {
        return Math.max(lo, Math.min(hi, v));
    }
}
