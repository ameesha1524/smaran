package org.smaran.service;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import lombok.extern.slf4j.Slf4j;
import org.smaran.domain.CognitiveObjectResult;
import org.smaran.domain.CognitiveProfile;
import org.smaran.domain.DomainReading;
import org.smaran.domain.Enums.GameType;
import org.smaran.domain.Enums.Mood;
import org.smaran.domain.Enums.MotorTier;
import org.smaran.domain.Enums.PeakWindow;
import org.smaran.domain.GameSession;
import org.smaran.domain.MoodLog;
import org.smaran.repo.CognitiveObjectResultRepository;
import org.smaran.repo.CognitiveProfileRepository;
import org.smaran.repo.GameSessionRepository;
import org.smaran.repo.MoodLogRepository;
import org.smaran.scoring.CognitiveScoringService;
import org.smaran.scoring.Contract.TargetState;
import org.smaran.web.Dto;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * The six-domain profile, and the routing it drives.
 *
 * Mirror of frontend/src/lib/cognitiveProfile.ts. The device routes offline; the
 * server routes with a month of history the device does not keep. They must
 * agree on the rules, so the rules live in both places and are written the same
 * way on purpose. Which game reads which domain lives in {@link CognitiveMap};
 * how a reading moves the profile lives in {@link CognitiveScoringService}.
 *
 * deriveGameRoute, in the order the questions are asked:
 *   0. is this one of her first two sessions?  → the onboarding, fixed
 *   1. is this within her peak window?       no → low-effort games only
 *   4. what is her motor tier?                  → timing games filtered, tap sizes
 *   2. is today's mood anxious or low?      yes → Family Grove first, 432 Hz, −1
 *   3. which domain declined most this week?    → its game goes second
 *   5. what phase is each family member at?     → resolved per member elsewhere
 *
 * Rule 4 runs before 2 and 3 (numbering kept from the design doc) so that a
 * game filtered out for her hand cannot be reordered back in.
 */
@Service
@Slf4j
public class CognitiveProfileService {

    private final CognitiveProfileRepository profiles;
    private final GameSessionRepository sessions;
    private final MoodLogRepository moods;
    private final CognitiveObjectResultRepository objectResults;
    private final ObjectMapper json;
    private final CognitiveScoringService scoring;

    public CognitiveProfileService(
            CognitiveProfileRepository profiles,
            GameSessionRepository sessions,
            MoodLogRepository moods,
            CognitiveObjectResultRepository objectResults,
            ObjectMapper json,
            CognitiveScoringService scoring) {
        this.profiles = profiles;
        this.sessions = sessions;
        this.moods = moods;
        this.objectResults = objectResults;
        this.json = json;
        this.scoring = scoring;
    }

    /* --------------------------------------------------------- accessors */

    public CognitiveProfile forPatient(String patientId) {
        return profiles.findById(patientId).orElseGet(() -> {
            CognitiveProfile p = new CognitiveProfile();
            p.setPatientId(patientId);
            p.setDomainScores(write(defaultScores()));
            return profiles.save(p);
        });
    }

    /** Every domain starts at the engine's neutral 50 and earns its level. */
    private Map<String, Double> defaultScores() {
        Map<String, Double> m = new LinkedHashMap<>();
        for (String d : CognitiveMap.DOMAINS) {
            m.put(d, CognitiveMap.NEUTRAL);
        }
        return m;
    }

    /** The engine state behind a profile, seeded from its domain scores where it has none. */
    public Map<String, TargetState> scoringState(CognitiveProfile profile) {
        return scoring.stateOf(profile.getScoringState(), scores(profile));
    }

    public Map<String, Double> scores(CognitiveProfile profile) {
        return read(profile.getDomainScores());
    }

    public Map<String, Double> clusters(CognitiveProfile profile) {
        return read(profile.getClusterAccuracy());
    }

    /* ------------------------------------------------------------ routing */

    public Dto.GameRouteDto deriveGameRoute(String patientId, Mood moodToday) {
        CognitiveProfile profile = forPatient(patientId);
        List<String> rationale = new ArrayList<>();

        int hour = Instant.now().atZone(ZoneId.systemDefault()).getHour();
        boolean inPeak = profile.getSelfReportedPeak().contains(hour);
        int tapTarget = switch (profile.getMotorTier()) {
            case FLUID -> 60;
            case MODERATE -> 76;
            case SUPPORTED -> 96;
        };

        // 0. The first two sessions are the onboarding: fixed, gentle, observed.
        long played = sessions.countByPatientId(patientId);
        if (played < 2) {
            boolean first = played == 0;
            rationale.add(first
                    ? "First session — Duck Roll Call at span 3. This is the onboarding: working-memory span, tap accuracy and hesitation are read here."
                    : "Second session — the Family Grove at phase 1, names visible. Affect is read here.");
            return new Dto.GameRouteDto(
                    patientId,
                    List.of(first ? GameType.DUCK_ROLL_CALL : GameType.FAMILY_GROVE),
                    1,
                    first ? 432 : 528,
                    tapTarget,
                    inPeak,
                    rationale);
        }

        int tier = 2;
        int ambientHz = 432;
        List<GameType> games = new ArrayList<>(CognitiveMap.ROUTE_GAMES);

        if (!inPeak) {
            games.retainAll(CognitiveMap.LOW_EFFORT);
            tier -= 1;
            rationale.add("Outside the peak window — only low-effort games are offered.");
        }

        if (profile.getMotorTier() == MotorTier.SUPPORTED) {
            games.removeAll(CognitiveMap.TIMING_GAMES);
            rationale.add("Motor tier is supported — timing-based games are not suggested.");
        }

        Mood mood = moodToday != null ? moodToday : latestMood(patientId);
        if (mood != null && mood.isLow()) {
            games.remove(GameType.FAMILY_GROVE);
            games.add(0, GameType.FAMILY_GROVE);
            tier -= 1;
            ambientHz = 432;
            rationale.add("Mood is low or restless — starting with Family Grove at 432 Hz, one tier easier.");
        } else if (!games.isEmpty() && games.get(0) == GameType.FAMILY_GROVE) {
            // Grounding rather than calm: the grove is the one game at 528 Hz.
            ambientHz = 528;
        }

        weakestDomain(patientId).ifPresent(domain -> {
            GameType target = CognitiveMap.DOMAIN_GAME.get(domain);
            if (target != null && games.contains(target)) {
                games.remove(target);
                games.add(Math.min(1, games.size()), target);
                rationale.add("%s declined most this week — its game is scheduled second.".formatted(domain));
            }
        });

        rationale.add("Tap targets set to %d px for a %s hand.".formatted(
                tapTarget, profile.getMotorTier().name().toLowerCase()));

        return new Dto.GameRouteDto(
                patientId,
                games,
                Math.max(1, Math.min(3, tier)),
                ambientHz,
                tapTarget,
                inPeak,
                rationale);
    }

    private Mood latestMood(String patientId) {
        return moods.findByPatientIdAndAtAfterOrderByAtAsc(patientId, Instant.now().minus(Duration.ofHours(18)))
                .stream()
                .reduce((a, b) -> b)
                .map(MoodLog::getMood)
                .orElse(null);
    }

    /* ------------------------------------------------- update per session */

    /**
     * Keep the engine's state on the profile, and the 0–1 domain scores (routing,
     * the report) re-derived from its levels. The scoring itself happens in
     * {@link SessionIngestionService}, the one place a session reaches a profile.
     */
    public void storeState(CognitiveProfile profile, Map<String, TargetState> state) {
        profile.setScoringState(scoring.write(state));
        profile.setDomainScores(write(org.smaran.scoring.LegacyScores.domainScoresFrom(state, scores(profile))));
        profile.setUpdatedAt(Instant.now());
    }

    /**
     * The signals read from behaviour rather than from a score: when she plays
     * best, how easily she is unsettled, whether the afternoons are harder, how
     * she does with each group of objects. Refreshed after the latest session.
     */
    public void refreshDerived(CognitiveProfile profile, GameSession latest) {
        int hour = latest.getHourOfDay() != null
                ? latest.getHourOfDay()
                : latest.getStartedAt().atZone(ZoneId.systemDefault()).getHour();
        profile.setDerivedPeak(PeakWindow.forHour(hour));
        profile.setAnxietyThreshold(deriveAnxietyThreshold(latest.getPatientId()));
        profile.setSundowningPattern(detectSundowning(latest.getPatientId()));
        profile.setClusterAccuracy(write(recomputeClusters(latest.getPatientId())));
        profile.setUpdatedAt(Instant.now());
    }

    /* ------------------------------------------------------- the signals */

    /**
     * Anxiety threshold, derived behaviourally and never self-reported. A lower
     * threshold means the adaptive layer eases her sessions sooner.
     */
    public double deriveAnxietyThreshold(String patientId) {
        List<GameSession> recent = sessions.findTop50ByPatientIdOrderByStartedAtDesc(patientId);
        if (recent.isEmpty()) {
            return 0.72;
        }
        long abandoned = recent.stream().filter(s -> s.getCompletionRate() < 0.4).count();
        long eased = recent.stream().filter(GameSession::isEasedMidSession).count();
        double threshold = 0.72;
        if ((double) abandoned / recent.size() > 0.2) {
            threshold -= 0.12;
        }
        if ((double) eased / recent.size() > 0.4) {
            threshold -= 0.06;
        }
        return Math.max(0.35, Math.min(0.85, round(threshold)));
    }

    /**
     * Sundowning: mood dips concentrated between three and seven in the evening.
     * When true, ReminderService stops scheduling game nudges after four.
     */
    public boolean detectSundowning(String patientId) {
        List<MoodLog> log = moods.findByPatientIdAndAtAfterOrderByAtAsc(patientId, Instant.now().minus(Duration.ofDays(21)));
        List<MoodLog> late = log.stream().filter(m -> m.getLocalHour() >= 15 && m.getLocalHour() <= 19).toList();
        if (late.size() < 4) {
            return false;
        }
        double lowLate = (double) late.stream().filter(m -> m.getMood().isLow()).count() / late.size();
        List<MoodLog> other = log.stream().filter(m -> m.getLocalHour() < 15 || m.getLocalHour() > 19).toList();
        double lowOther = other.isEmpty()
                ? 0
                : (double) other.stream().filter(m -> m.getMood().isLow()).count() / other.size();
        return lowLate >= 0.55 && lowLate > lowOther + 0.2;
    }

    /**
     * Per-cluster recognition accuracy over 30 days. A cluster falling while its
     * neighbours hold is a declining memory domain — not fading cultural
     * knowledge — and that is the distinction the dashboard reports.
     */
    public Map<String, Double> recomputeClusters(String patientId) {
        List<CognitiveObjectResult> results =
                objectResults.findByPatientIdAndCapturedAtAfter(patientId, Instant.now().minus(Duration.ofDays(30)));
        Map<String, int[]> tally = new HashMap<>();
        for (CognitiveObjectResult r : results) {
            int[] t = tally.computeIfAbsent(r.getSemanticCluster().name(), k -> new int[2]);
            t[1]++;
            if (r.isWasCorrect()) {
                t[0]++;
            }
        }
        Map<String, Double> out = new LinkedHashMap<>();
        tally.forEach((k, t) -> out.put(k, round((double) t[0] / t[1])));
        return out;
    }

    /** Which domain fell furthest this week. Drives the session's second game. */
    public java.util.Optional<String> weakestDomain(String patientId) {
        List<GameSession> week =
                sessions.findByPatientIdAndStartedAtAfterOrderByStartedAtAsc(patientId, Instant.now().minus(Duration.ofDays(7)));
        if (week.size() < 3) {
            return java.util.Optional.empty();
        }
        List<CognitiveMap.Dated> history = week.stream()
                .map(s -> new CognitiveMap.Dated(s.getStartedAt(), readingsOf(s)))
                .toList();
        return CognitiveMap.weakestDomain(history, Instant.now());
    }

    /**
     * The 0–1 readings a stored session contributed, per legacy domain name. For
     * a session stored with an envelope they are its contributions to the six
     * domains; for an older one, the readings it stored then.
     */
    public Map<String, DomainReading> readingsOf(GameSession session) {
        if (session.getContributions() != null && !session.getContributions().isBlank()) {
            Map<String, DomainReading> out = new LinkedHashMap<>();
            try {
                List<org.smaran.scoring.Contract.ScoreContribution> cs = json.readValue(
                        session.getContributions(), new TypeReference<>() { });
                org.smaran.scoring.LegacyScores.DOMAIN_ID_OF.forEach((legacy, id) -> cs.stream()
                        .filter(c -> id.equals(c.target()))
                        .findFirst()
                        .ifPresent(c -> out.put(legacy, new DomainReading(c.raw() / 100d, c.confidence()))));
                return CognitiveMap.sanitize(out);
            } catch (Exception e) {
                log.warn("unreadable contributions on {}, using legacy readings: {}", session.getId(), e.getMessage());
            }
        }
        return legacyReadingsOf(session);
    }

    /**
     * Sessions stored before the envelope existed fall back to completion rate
     * against the game's primary domain, the same answer they gave at the time.
     */
    public Map<String, DomainReading> legacyReadingsOf(GameSession session) {
        Map<String, DomainReading> stored = null;
        String raw = session.getDomainReadings();
        if (raw != null && !raw.isBlank()) {
            try {
                stored = json.readValue(raw, new TypeReference<Map<String, DomainReading>>() {
                });
            } catch (Exception e) {
                log.warn("unreadable session readings on {}, using completion rate: {}", session.getId(), e.getMessage());
            }
        }
        return CognitiveMap.readingsFor(session.getGameType(), session.getCompletionRate(), stored);
    }

    /* ---------------------------------------------------------- mapping */

    public Dto.CognitiveProfileDto toDto(CognitiveProfile p) {
        return new Dto.CognitiveProfileDto(
                p.getPatientId(),
                scores(p),
                scoringState(p),
                p.getMotorTier(),
                p.getAnxietyThreshold(),
                p.getStartingPhase(),
                p.isSundowningPattern(),
                clusters(p),
                p.getSelfReportedPeak(),
                p.getDerivedPeak(),
                p.getUpdatedAt());
    }

    public List<String> domains() {
        return CognitiveMap.DOMAINS;
    }

    /* --------------------------------------------------------- plumbing */

    private Map<String, Double> read(String raw) {
        try {
            return json.readValue(raw == null || raw.isBlank() ? "{}" : raw, new TypeReference<>() {
            });
        } catch (Exception e) {
            log.warn("unreadable profile json, falling back to defaults: {}", e.getMessage());
            return new LinkedHashMap<>();
        }
    }

    private String write(Map<String, Double> map) {
        try {
            return json.writeValueAsString(map);
        } catch (Exception e) {
            return "{}";
        }
    }

    private static double round(double v) {
        return Math.round(v * 1000d) / 1000d;
    }
}
