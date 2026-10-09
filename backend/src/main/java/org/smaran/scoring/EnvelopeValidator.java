package org.smaran.scoring;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.time.Duration;
import java.time.Instant;
import java.time.format.DateTimeParseException;
import java.util.HashSet;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.regex.Pattern;
import org.smaran.domain.Enums.Mood;
import org.smaran.scoring.Contract.ScoreContribution;
import org.smaran.scoring.Contract.SessionEnvelope;
import org.springframework.stereotype.Component;

/**
 * The checks a session passes before the server believes any of it.
 *
 * This is the trust boundary, stated plainly: the tablet computes the scores
 * (so the profile on the glass and the profile on the server agree, offline),
 * and the server accepts them after the checks below. The checks catch a
 * malformed, impossible or out-of-bounds session. They do not catch a tablet
 * that lies inside the allowed range; the stored session says so
 * ({@code scoring_trust = device}), and the server re-scores games whose raw
 * trials it understands (see {@link org.smaran.service.Rescorer}) so a disagreement is counted.
 *
 * A rejected session is reported with a reason and never stored. One bad row
 * does not fail the rest of a batch.
 */
@Component
public class EnvelopeValidator {

    private static final Pattern UUID = Pattern.compile(
            "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}");

    static final Duration MAX_FUTURE = Duration.ofMinutes(10);
    static final Duration MAX_AGE = Duration.ofDays(400);
    static final long MAX_DURATION_MS = Duration.ofHours(6).toMillis();
    static final int MAX_TRIALS = 500;
    static final int MAX_TRIALS_BYTES = 128 * 1024;
    static final int MAX_CONTRIBUTIONS = 16;
    static final int MAX_BECAUSE = 280;
    static final int MAX_PARAMS = 20;

    private final GameRegistry registry;
    private final ObjectMapper json;

    public EnvelopeValidator(GameRegistry registry, ObjectMapper json) {
        this.registry = registry;
        this.json = json;
    }

    /** What was wrong, or empty if the session may be stored. */
    public Optional<String> reject(SessionEnvelope e, Instant now) {
        if (e == null) {
            return Optional.of("empty session");
        }
        if (e.clientSessionId() == null || !UUID.matcher(e.clientSessionId()).matches()) {
            return Optional.of("clientSessionId must be a UUID");
        }
        GameRegistry.Entry game = registry.find(e.gameId()).orElse(null);
        if (game == null) {
            return Optional.of("unknown game");
        }
        if (game.retired()) {
            return Optional.of("this game is retired and no longer sends sessions");
        }

        Instant started;
        try {
            started = Instant.parse(e.startedAt());
        } catch (DateTimeParseException | NullPointerException ex) {
            return Optional.of("startedAt must be an ISO-8601 instant");
        }
        if (started.isAfter(now.plus(MAX_FUTURE))) {
            return Optional.of("startedAt is in the future");
        }
        if (started.isBefore(now.minus(MAX_AGE))) {
            return Optional.of("startedAt is too old");
        }
        if (e.durationMs() < 0 || e.durationMs() > MAX_DURATION_MS) {
            return Optional.of("durationMs out of range");
        }
        if (e.hourOfDay() < 0 || e.hourOfDay() > 23) {
            return Optional.of("hourOfDay out of range");
        }
        if (e.moodAtStart() != null && moodOf(e.moodAtStart()) == null) {
            return Optional.of("unknown mood");
        }
        if (e.engineVersion() == null || e.engineVersion().isBlank() || e.engineVersion().length() > 20) {
            return Optional.of("engineVersion missing");
        }
        if (e.difficulty() != null) {
            if (e.difficulty().tier() < 0 || e.difficulty().tier() > 10) {
                return Optional.of("difficulty tier out of range");
            }
            if (e.difficulty().params() != null && e.difficulty().params().size() > MAX_PARAMS) {
                return Optional.of("too many difficulty parameters");
            }
        }

        List<Object> trials = e.trials() == null ? List.of() : e.trials();
        if (trials.size() > MAX_TRIALS) {
            return Optional.of("too many trials");
        }
        try {
            if (json.writeValueAsBytes(trials).length > MAX_TRIALS_BYTES) {
                return Optional.of("trials are too large");
            }
        } catch (Exception ex) {
            return Optional.of("trials could not be read");
        }

        return rejectContributions(e, game);
    }

    private Optional<String> rejectContributions(SessionEnvelope e, GameRegistry.Entry game) {
        List<ScoreContribution> cs = e.contributions() == null ? List.of() : e.contributions();
        if (cs.size() > MAX_CONTRIBUTIONS) {
            return Optional.of("too many contributions");
        }
        Set<String> seen = new HashSet<>();
        for (ScoreContribution c : cs) {
            if (c == null || c.target() == null || !Contract.TARGET_IDS.contains(c.target())) {
                return Optional.of("a contribution names an unknown target");
            }
            if (!game.targets().contains(c.target())) {
                return Optional.of("%s does not measure %s".formatted(game.title(), c.target()));
            }
            if (!seen.add(c.target())) {
                return Optional.of("two contributions to " + c.target());
            }
            if (!Double.isFinite(c.raw()) || c.raw() < 0 || c.raw() > 100) {
                return Optional.of("a contribution's raw score is outside 0 to 100");
            }
            if (!Double.isFinite(c.confidence()) || c.confidence() < 0 || c.confidence() > 1) {
                return Optional.of("a contribution's confidence is outside 0 to 1");
            }
            if (c.because() != null && c.because().length() > MAX_BECAUSE * 4) {
                return Optional.of("a contribution's explanation is far too long");
            }
        }
        Contract.SessionMarkers m = e.markers();
        if (m != null) {
            if (outside(m.workingMemorySpan(), 0, 12)
                    || outside(m.inhibitionBreakdownTier(), 0, 10)
                    || outside(m.trajectoryPrecisionMs(), 0, 20000)) {
                return Optional.of("a marker is out of range");
            }
        }
        return Optional.empty();
    }

    /** The mood, or null if the text is not one. */
    public static Mood moodOf(String text) {
        try {
            return text == null ? null : Mood.valueOf(text);
        } catch (IllegalArgumentException ex) {
            return null;
        }
    }

    /** The explanation as it will be stored: bounded, single-line, no control characters. */
    public static String cleanBecause(String text) {
        if (text == null) {
            return "";
        }
        String s = text.replaceAll("\\p{Cntrl}", " ").strip();
        return s.length() > MAX_BECAUSE ? s.substring(0, MAX_BECAUSE) : s;
    }

    private static boolean outside(Double v, double lo, double hi) {
        return v != null && (!Double.isFinite(v) || v < lo || v > hi);
    }
}
