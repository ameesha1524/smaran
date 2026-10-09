package org.smaran.scoring;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import org.smaran.scoring.Contract.ScoreContribution;

/**
 * Duck Roll Call, scored (docs/MASTER_PROMPT.md, Appendix A.5). The Java twin of
 * frontend/src/games/modules/duckRollCall.ts; both are held to
 * duck-roll-call-vectors.json by a test, so neither can drift without one failing.
 *
 * <h3>What a trial is</h3>
 * One round: all the ducklings flash a number together, the numbers vanish, and
 * she taps them in ascending order from memory.
 * {@code spanLength}, {@code flashDurationMs}, {@code correctFirstAttempt},
 * {@code attempts} (wrong taps + 1), {@code firstErrorAtPosition} (null if none),
 * {@code timeToFirstTapMs}, {@code completedRound} (false if she left mid-round)
 * and {@code positionReached} (correct taps made, used only when not completed).
 *
 * <h3>The scores</h3>
 * <pre>
 *   effective span   clean round = N        a round with wrong taps = N - 0.5
 *                    a round left unfinished = the position she reached
 *   flash bonus      up to +25%, for a flash shorter than 2000 ms:
 *                    0.25 * clamp((2000 - flash) / 1200, 0, 1)
 *   round score      effective span * (1 + flash bonus)
 *   EXECUTIVE and WORKING_MEMORY_SPAN
 *                    raw = clamp(100 * mean(round score) / 6, 0, 100)
 *                    so a clean span of 3 at the slow flash reads 50, and a clean 6 reads 100
 *   VISUAL_SEMANTIC  (weak) retrieval speed: speed = clamp((6000 - time to first tap) / 5000, 0, 1)
 *                    raw = 100 * mean(speed), at 0.4 of the confidence
 *   confidence       max(0.15, min(1, rounds / 8))
 * </pre>
 *
 * "No trial-level data" is not a limitation here: the rounds are the data.
 */
public final class DuckRollCallScoring {

    private DuckRollCallScoring() {
    }

    public static List<ScoreContribution> score(List<?> trials) {
        List<ScoreContribution> out = new ArrayList<>();
        if (trials == null || trials.isEmpty()) {
            return out;
        }
        double sumScore = 0;
        double sumSpeed = 0;
        int speedCount = 0;
        int n = 0;
        for (Object row : trials) {
            if (!(row instanceof Map<?, ?> t)) {
                continue;
            }
            Double span = number(t.get("spanLength"));
            Double flash = number(t.get("flashDurationMs"));
            if (span == null || flash == null) {
                continue;
            }
            boolean completed = !Boolean.FALSE.equals(t.get("completedRound"));
            boolean clean = Boolean.TRUE.equals(t.get("correctFirstAttempt"));
            Double reached = number(t.get("positionReached"));
            double effective = completed ? (clean ? span : span - 0.5) : (reached == null ? 0 : reached);
            double bonus = 0.25 * clamp((2000 - flash) / 1200, 0, 1);
            sumScore += effective * (1 + bonus);
            Double first = number(t.get("timeToFirstTapMs"));
            if (first != null) {
                sumSpeed += clamp((6000 - first) / 5000, 0, 1);
                speedCount++;
            }
            n++;
        }
        if (n == 0) {
            return out;
        }
        double raw = clamp(100 * (sumScore / n) / 6, 0, 100);
        double confidence = Math.max(0.15, Math.min(1, n / 8.0));
        out.add(new ScoreContribution("EXECUTIVE", raw, confidence, ""));
        out.add(new ScoreContribution("WORKING_MEMORY_SPAN", raw, confidence, ""));
        if (speedCount > 0) {
            out.add(new ScoreContribution("VISUAL_SEMANTIC", 100 * sumSpeed / speedCount, 0.4 * confidence, ""));
        }
        return out;
    }

    private static Double number(Object o) {
        if (o instanceof Number n && Double.isFinite(n.doubleValue())) {
            return n.doubleValue();
        }
        return null;
    }

    private static double clamp(double v, double lo, double hi) {
        return Math.max(lo, Math.min(hi, v));
    }
}
