package org.smaran.scoring;

import org.smaran.scoring.Contract.AlertRule;

/**
 * The engine's constants. Mirror of {@code DEFAULT_CONFIG} in
 * frontend/src/lib/scoring/types.ts; ContractTest holds the two to the same
 * values through golden-vectors.json.
 *
 * @param baseAlpha alpha = baseAlpha × confidence
 * @param window how many raws the baseline and SD look back over
 * @param minBaselineObservations below this many prior raws, the baseline is the level
 * @param minSdObservations below this many prior raws, the SD is {@code priorSd}
 * @param minSd floor on the SD, so identical scores cannot produce an infinite velocity
 * @param confidenceGate below this domain confidence, status is stable and nothing alerts
 * @param cusumK CUSUM slack, in SD units
 * @param cusumH CUSUM decision threshold: decline at h, watch at h / 2
 */
public record ScoringConfig(
        double baseAlpha,
        double startLevel,
        int window,
        int minBaselineObservations,
        int minSdObservations,
        double priorSd,
        double minSd,
        int fullConfidenceObservations,
        double confidenceGate,
        double declineVelocity,
        double watchVelocity,
        double improvingVelocity,
        AlertRule alertRule,
        double cusumK,
        double cusumH) {

    public static final ScoringConfig DEFAULT = new ScoringConfig(
            0.25, 50, 30, 3, 5, 12, 3, 12, 0.35, -1.5, -0.8, 1.0, AlertRule.TWO_CONSECUTIVE, 0.5, 4);

    public ScoringConfig withAlertRule(AlertRule rule, double k, double h) {
        return new ScoringConfig(
                baseAlpha, startLevel, window, minBaselineObservations, minSdObservations, priorSd, minSd,
                fullConfidenceObservations, confidenceGate, declineVelocity, watchVelocity, improvingVelocity,
                rule, k, h);
    }
}
