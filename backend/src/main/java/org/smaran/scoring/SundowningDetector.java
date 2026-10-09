package org.smaran.scoring;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * Is she doing worse in the late afternoon than in the morning?
 *
 * "Sundowning" is a late-day worsening of confusion that some people with dementia
 * have. This does not diagnose it. It asks one narrow question of her games: over
 * the last month, do her sittings between 3 and 7 in the evening score lower than
 * her sittings between 6 and 11 in the morning, by enough to be more than noise?
 *
 * <ul>
 *   <li><b>Fair comparison.</b> Games are not equally hard, and one that is only
 *       ever played in the afternoon would look like a dip. Each sitting's score is
 *       taken relative to the average for its own game over the window.</li>
 *   <li><b>A minimum-sessions guard.</b> At least six sittings in each part of the
 *       day. Below that, nothing is said, however large the difference looks.</li>
 *   <li><b>An effect-size rule, not a p-value.</b> Cohen's d, the gap between the
 *       two means in units of their pooled spread. Flagged at 0.8 or more (a large
 *       effect by convention); an open flag ends when d falls below 0.5, so it does
 *       not flicker around the line. The pooled spread has a floor of 3 points,
 *       as the engine's does, so a run of identical scores cannot make a tiny gap
 *       look enormous.</li>
 * </ul>
 *
 * Pure: it takes sittings and returns a verdict.
 */
public final class SundowningDetector {

    private SundowningDetector() {
    }

    public static final int MIN_PER_PART = 6;
    public static final double FLAG_AT = 0.8;
    public static final double END_BELOW = 0.5;
    static final double MIN_SPREAD = 3;

    /** One sitting: which game, the local hour it began, and how it scored (0 to 100). */
    public record Sitting(String gameId, int hour, double score) {
    }

    public record Verdict(boolean enoughData, double effectSize, int morning, int lateAfternoon) {
        public boolean flagged() {
            return enoughData && effectSize >= FLAG_AT;
        }

        public boolean clear() {
            return !enoughData || effectSize < END_BELOW;
        }
    }

    public static boolean isMorning(int hour) {
        return hour >= 6 && hour <= 11;
    }

    public static boolean isLateAfternoon(int hour) {
        return hour >= 15 && hour <= 19;
    }

    public static Verdict evaluate(List<Sitting> sittings) {
        Map<String, double[]> perGame = new HashMap<>();
        for (Sitting s : sittings) {
            double[] acc = perGame.computeIfAbsent(s.gameId(), k -> new double[2]);
            acc[0] += s.score();
            acc[1] += 1;
        }
        List<Double> morning = new ArrayList<>();
        List<Double> late = new ArrayList<>();
        for (Sitting s : sittings) {
            double[] acc = perGame.get(s.gameId());
            double relative = s.score() - acc[0] / acc[1];
            if (isMorning(s.hour())) {
                morning.add(relative);
            } else if (isLateAfternoon(s.hour())) {
                late.add(relative);
            }
        }
        if (morning.size() < MIN_PER_PART || late.size() < MIN_PER_PART) {
            return new Verdict(false, 0, morning.size(), late.size());
        }
        double m = mean(morning);
        double l = mean(late);
        double pooled = Math.sqrt(
                ((morning.size() - 1) * variance(morning, m) + (late.size() - 1) * variance(late, l))
                        / (morning.size() + late.size() - 2));
        double d = (m - l) / Math.max(MIN_SPREAD, pooled);
        return new Verdict(true, d, morning.size(), late.size());
    }

    private static double mean(List<Double> xs) {
        double sum = 0;
        for (double x : xs) {
            sum += x;
        }
        return sum / xs.size();
    }

    private static double variance(List<Double> xs, double mean) {
        double ss = 0;
        for (double x : xs) {
            ss += (x - mean) * (x - mean);
        }
        return xs.size() < 2 ? 0 : ss / (xs.size() - 1);
    }
}
