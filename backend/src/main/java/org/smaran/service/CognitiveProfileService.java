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
import org.smaran.web.Dto;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * The five-domain profile, and the routing it drives.
 *
 * Mirror of frontend/src/lib/cognitiveProfile.ts. The device routes offline; the
 * server routes with a month of history the device does not keep. They must
 * agree on the rules, so the rules live in both places and are written the same
 * way on purpose.
 *
 * deriveGameRoute, in the order the questions are asked:
 *   1. is this within her peak window?       no → low-effort games only
 *   2. is today's mood anxious or low?      yes → Family Grove first, 432 Hz, −1
 *   3. which domain declined most this week?    → its game goes second
 *   4. what is her motor tier?                  → tap sizes, timing mechanics
 *   5. what phase is each family member at?     → resolved per member elsewhere
 */
@Service
@Slf4j
public class CognitiveProfileService {

    private static final List<String> DOMAINS =
            List.of("language", "visualSemantic", "motor", "affective", "temporal");

    private static final Map<String, GameType> DOMAIN_GAMES = Map.of(
            "language", GameType.GRANDMOTHERS_TALE,
            "visualSemantic", GameType.WEAVERS_LOOM,
            "motor", GameType.MORNING_RITUALS,
            "affective", GameType.FAMILY_GROVE,
            "temporal", GameType.MORNING_RITUALS);

    private final CognitiveProfileRepository profiles;
    private final GameSessionRepository sessions;
    private final MoodLogRepository moods;
    private final CognitiveObjectResultRepository objectResults;
    private final ObjectMapper json;

    public CognitiveProfileService(
            CognitiveProfileRepository profiles,
            GameSessionRepository sessions,
            MoodLogRepository moods,
            CognitiveObjectResultRepository objectResults,
            ObjectMapper json) {
        this.profiles = profiles;
        this.sessions = sessions;
        this.moods = moods;
        this.objectResults = objectResults;
        this.json = json;
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

    private Map<String, Double> defaultScores() {
        Map<String, Double> m = new LinkedHashMap<>();
        m.put("language", 0.6);
        m.put("visualSemantic", 0.6);
        m.put("motor", 0.6);
        m.put("affective", 0.7);
        // Nothing measures temporal orientation until Morning Rituals has run
        // once; 0.6 is honest about that rather than inventing a reading.
        m.put("temporal", 0.6);
        return m;
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
        int tier = 2;
        int ambientHz = 432;

        List<GameType> games = new ArrayList<>(
                List.of(GameType.WEAVERS_LOOM, GameType.GRANDMOTHERS_TALE, GameType.FAMILY_GROVE, GameType.MORNING_RITUALS));

        if (!inPeak) {
            games.removeIf(g -> g != GameType.FAMILY_GROVE && g != GameType.MORNING_RITUALS);
            tier -= 1;
            rationale.add("Outside the peak window — only low-effort games are offered.");
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
            GameType target = DOMAIN_GAMES.get(domain);
            if (target != null && games.contains(target)) {
                games.remove(target);
                games.add(Math.min(1, games.size()), target);
                rationale.add("%s declined most this week — its game is scheduled second.".formatted(domain));
            }
        });

        int tapTarget = switch (profile.getMotorTier()) {
            case FLUID -> 60;
            case MODERATE -> 76;
            case SUPPORTED -> 96;
        };
        if (profile.getMotorTier() == MotorTier.SUPPORTED) {
            rationale.add("Motor tier is supported — timing-based mechanics are switched off.");
        }
        rationale.add("Tap targets set to %d px.".formatted(tapTarget));

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
     * Applied after every session. An exponential moving average, weighted 3:1
     * toward history, so that one bad afternoon never rewrites a person.
     */
    @Transactional
    public CognitiveProfile updateFromSession(GameSession session) {
        CognitiveProfile profile = forPatient(session.getPatientId());
        Map<String, Double> scores = new LinkedHashMap<>(scores(profile));

        String domain = switch (session.getGameType()) {
            case WEAVERS_LOOM -> "visualSemantic";
            case GRANDMOTHERS_TALE -> "language";
            case FAMILY_GROVE -> "affective";
            case MORNING_RITUALS -> "temporal";
        };
        double prior = scores.getOrDefault(domain, 0.6);
        scores.put(domain, round(prior * 0.75 + session.getCompletionRate() * 0.25));

        // Hesitation and easing are motor and affective signals in their own
        // right, independent of which game produced them.
        if (session.isEasedMidSession()) {
            scores.put("affective", round(scores.getOrDefault("affective", 0.7) * 0.9));
        }

        profile.setDomainScores(write(scores));
        profile.setDerivedPeak(PeakWindow.forHour(
                session.getStartedAt().atZone(ZoneId.systemDefault()).getHour()));
        profile.setAnxietyThreshold(deriveAnxietyThreshold(session.getPatientId()));
        profile.setSundowningPattern(detectSundowning(session.getPatientId()));
        profile.setClusterAccuracy(write(recomputeClusters(session.getPatientId())));
        profile.setUpdatedAt(Instant.now());
        return profiles.save(profile);
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
        Map<String, List<Double>> byDomain = new HashMap<>();
        for (GameSession s : week) {
            String domain = switch (s.getGameType()) {
                case WEAVERS_LOOM -> "visualSemantic";
                case GRANDMOTHERS_TALE -> "language";
                case FAMILY_GROVE -> "affective";
                case MORNING_RITUALS -> "temporal";
            };
            byDomain.computeIfAbsent(domain, k -> new ArrayList<>()).add(s.getCompletionRate());
        }
        return byDomain.entrySet().stream()
                .filter(e -> e.getValue().size() >= 2)
                .map(e -> Map.entry(e.getKey(), trendOf(e.getValue())))
                // Most negative trend first; ignore anything that is holding.
                .filter(e -> e.getValue() < -0.05)
                .min(Comparator.comparingDouble(Map.Entry::getValue))
                .map(Map.Entry::getKey);
    }

    /** Last value minus first: a blunt instrument, and the right one at n < 10. */
    private static double trendOf(List<Double> values) {
        return values.get(values.size() - 1) - values.get(0);
    }

    /* ---------------------------------------------------------- mapping */

    public Dto.CognitiveProfileDto toDto(CognitiveProfile p) {
        return new Dto.CognitiveProfileDto(
                p.getPatientId(),
                scores(p),
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
        return DOMAINS;
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
