package org.smaran.service;

import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.EnumMap;
import java.util.EnumSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import org.smaran.domain.DomainReading;
import org.smaran.domain.Enums.GameType;

/**
 * The cognitive map: which game reads which domain, and what a session
 * measured.
 *
 * Mirror of frontend/src/lib/cognitiveMap.ts.
 *
 * {@link #readingsFor} answers what a session measured: its own readings if it
 * sent any (Duck Roll Call, Koi Are Jumping and the Lotus Frog do), otherwise
 * its completion rate against the game's primary domain. How a reading then
 * moves the profile is not decided here; that is
 * {@link org.smaran.scoring.CognitiveScoringService}, the single scoring path.
 *
 * Pure functions only — no repositories, no clock of its own.
 */
// The retired WEAVERS_LOOM is referenced on purpose: its stored sessions still map to a domain.
@SuppressWarnings("deprecation")
public final class CognitiveMap {

    private CognitiveMap() {
    }

    public static final List<String> DOMAINS =
            List.of("language", "visualSemantic", "motor", "affective", "temporal", "executiveFunction");

    /** Where a domain starts when nothing has measured it yet. */
    public static final double NEUTRAL = 0.5;

    private static final Map<GameType, String> PRIMARY = new EnumMap<>(GameType.class);

    static {
        PRIMARY.put(GameType.GRANDMOTHERS_TALE, "language");
        PRIMARY.put(GameType.LOTUS_FROG, "visualSemantic");
        PRIMARY.put(GameType.KOI_ARE_JUMPING, "motor");
        PRIMARY.put(GameType.FAMILY_GROVE, "affective");
        PRIMARY.put(GameType.MORNING_RITUALS, "temporal");
        PRIMARY.put(GameType.DUCK_ROLL_CALL, "executiveFunction");
        // Retired, but its stored sessions still belong to a domain.
        PRIMARY.put(GameType.WEAVERS_LOOM, "visualSemantic");
    }

    /** When a domain declines, the game that exercises it most directly. */
    public static final Map<String, GameType> DOMAIN_GAME = Map.of(
            "language", GameType.GRANDMOTHERS_TALE,
            "visualSemantic", GameType.LOTUS_FROG,
            "motor", GameType.KOI_ARE_JUMPING,
            "affective", GameType.FAMILY_GROVE,
            "temporal", GameType.MORNING_RITUALS,
            "executiveFunction", GameType.DUCK_ROLL_CALL);

    /** The day's rotation, before routing reorders or filters it. */
    public static final List<GameType> ROUTE_GAMES = List.of(
            GameType.DUCK_ROLL_CALL,
            GameType.GRANDMOTHERS_TALE,
            GameType.FAMILY_GROVE,
            GameType.MORNING_RITUALS,
            GameType.KOI_ARE_JUMPING,
            GameType.LOTUS_FROG);

    /** Offered outside her peak window: nothing to hold in mind, nothing to get wrong. */
    public static final Set<GameType> LOW_EFFORT = Collections.unmodifiableSet(EnumSet.of(
            GameType.FAMILY_GROVE, GameType.MORNING_RITUALS, GameType.KOI_ARE_JUMPING, GameType.LOTUS_FROG));

    /** Games whose core mechanic is a response window — dropped for a supported hand. */
    public static final Set<GameType> TIMING_GAMES = Collections.unmodifiableSet(EnumSet.of(GameType.KOI_ARE_JUMPING));

    public static String primaryDomain(GameType type) {
        return PRIMARY.get(type);
    }

    /* ------------------------------------------------------------ update */

    /**
     * Keep only what could be real: known domains, finite numbers clamped to
     * 0–1, nothing with zero confidence. Returned in {@link #DOMAINS} order.
     */
    public static Map<String, DomainReading> sanitize(Map<String, DomainReading> input) {
        Map<String, DomainReading> out = new LinkedHashMap<>();
        if (input == null) {
            return out;
        }
        for (String d : DOMAINS) {
            DomainReading r = input.get(d);
            if (r == null || !Double.isFinite(r.score()) || !Double.isFinite(r.confidence())) {
                continue;
            }
            double confidence = clamp(r.confidence());
            if (confidence <= 0) {
                continue;
            }
            out.put(d, new DomainReading(round(clamp(r.score())), round(confidence)));
        }
        return out;
    }

    /** What a session measured — its own readings if it sent any, else its completion rate. */
    public static Map<String, DomainReading> readingsFor(
            GameType type, double completionRate, Map<String, DomainReading> own) {
        Map<String, DomainReading> clean = sanitize(own);
        if (!clean.isEmpty()) {
            return clean;
        }
        String domain = primaryDomain(type);
        if (domain == null) {
            return clean;
        }
        return sanitize(Map.of(domain, new DomainReading(completionRate, 1)));
    }

    /* ---------------------------------------------------- weakest domain */

    public record Dated(Instant at, Map<String, DomainReading> readings) {
    }

    /**
     * Which domain fell furthest this week. At least three sessions in the last
     * seven days, at least two readings of the domain; trend is last minus
     * first, and only a fall of more than 0.05 counts.
     */
    public static Optional<String> weakestDomain(List<Dated> history, Instant now) {
        Instant cutoff = now.minus(Duration.ofDays(7));
        List<Dated> week = new ArrayList<>(history.stream().filter(h -> h.at().isAfter(cutoff)).toList());
        week.sort(Comparator.comparing(Dated::at));
        if (week.size() < 3) {
            return Optional.empty();
        }
        String worst = null;
        double worstTrend = -0.05;
        for (String d : DOMAINS) {
            List<Double> series = week.stream()
                    .map(h -> h.readings().get(d))
                    .filter(r -> r != null)
                    .map(DomainReading::score)
                    .toList();
            if (series.size() < 2) {
                continue;
            }
            double trend = series.get(series.size() - 1) - series.get(0);
            if (trend < worstTrend) {
                worstTrend = trend;
                worst = d;
            }
        }
        return Optional.ofNullable(worst);
    }

    /* ----------------------------------------------------------- helpers */

    static double clamp(double v) {
        return Math.max(0, Math.min(1, v));
    }

    static double round(double v) {
        return Math.round(v * 1000d) / 1000d;
    }
}
