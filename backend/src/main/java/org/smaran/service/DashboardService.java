package org.smaran.service;

import com.fasterxml.jackson.core.type.TypeReference;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;
import org.smaran.domain.Alert;
import org.smaran.domain.CognitiveProfile;
import org.smaran.domain.GameSession;
import org.smaran.domain.GardenState;
import org.smaran.domain.Patient;
import org.smaran.domain.ProfileSnapshot;
import org.smaran.repo.GameSessionRepository;
import org.smaran.repo.MoodLogRepository;
import org.smaran.repo.PatientRepository;
import org.smaran.repo.ProfileSnapshotRepository;
import org.smaran.scoring.Contract;
import org.smaran.scoring.Contract.ScoreContribution;
import org.smaran.scoring.Contract.TargetState;
import org.smaran.scoring.GameRegistry;
import org.smaran.web.Dto;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Everything the dashboards show, read from what ingestion stored.
 *
 * Nothing here scores anything. Levels, velocities and statuses come from the
 * profile and its snapshots, sessions from the sessions table, alerts from the
 * alerts table. So a dashboard shows exactly what the engine concluded, at the
 * time it concluded it, and a doctor and a family member are looking at the
 * same numbers.
 *
 * The doctor's view is the same view without the people around her.
 */
@Service
public class DashboardService {

    private static final DateTimeFormatter DAY =
            DateTimeFormatter.ofPattern("yyyy-MM-dd").withZone(ZoneId.systemDefault());

    private static final List<String> DOMAINS =
            List.of("LANGUAGE", "VISUAL_SEMANTIC", "MOTOR", "AFFECTIVE", "TEMPORAL", "EXECUTIVE");

    static final Map<String, String> LABEL = Map.ofEntries(
            Map.entry("LANGUAGE", "Language"),
            Map.entry("VISUAL_SEMANTIC", "Recognising pictures and faces"),
            Map.entry("MOTOR", "Movement and tapping"),
            Map.entry("AFFECTIVE", "Mood and feeling"),
            Map.entry("TEMPORAL", "Order of the day"),
            Map.entry("EXECUTIVE", "Planning and holding things in mind"),
            Map.entry("WORKING_MEMORY_SPAN", "Holding a few things in mind"),
            Map.entry("INHIBITORY_CONTROL", "Holding back a reaction"),
            Map.entry("COGNITIVE_FLEXIBILITY", "Switching between things"),
            Map.entry("TRAJECTORY_PREDICTION", "Following something that moves"),
            Map.entry("REACTION_SPEED", "Reaction speed"),
            Map.entry("SUSTAINED_ATTENTION", "Staying with a task"));

    private static final TypeReference<Map<String, Double>> DOUBLES = new TypeReference<>() {
    };
    private static final TypeReference<Map<String, String>> STRINGS = new TypeReference<>() {
    };
    private static final TypeReference<Contract.SessionMarkers> MARKERS = new TypeReference<>() {
    };

    private final PatientRepository patients;
    private final GameSessionRepository sessions;
    private final MoodLogRepository moods;
    private final ProfileSnapshotRepository snapshots;
    private final CognitiveProfileService profiles;
    private final GardenStateService gardens;
    private final FamilyGroveAdaptationService grove;
    private final AudioBiomarkerService biomarkers;
    private final AlertService alerts;
    private final GameRegistry registry;
    private final SessionRecords records;
    private final org.springframework.jdbc.core.JdbcTemplate jdbc;

    public DashboardService(
            PatientRepository patients,
            GameSessionRepository sessions,
            MoodLogRepository moods,
            ProfileSnapshotRepository snapshots,
            CognitiveProfileService profiles,
            GardenStateService gardens,
            FamilyGroveAdaptationService grove,
            AudioBiomarkerService biomarkers,
            AlertService alerts,
            GameRegistry registry,
            SessionRecords records,
            org.springframework.jdbc.core.JdbcTemplate jdbc) {
        this.patients = patients;
        this.sessions = sessions;
        this.moods = moods;
        this.snapshots = snapshots;
        this.profiles = profiles;
        this.gardens = gardens;
        this.grove = grove;
        this.biomarkers = biomarkers;
        this.alerts = alerts;
        this.registry = registry;
        this.records = records;
        this.jdbc = jdbc;
    }

    /** @param doctor true for a doctor: the same view, without the family around her */
    @Transactional(readOnly = true)
    public Dto.DashboardView view(String patientId, boolean doctor) {
        Patient patient = patients.findById(patientId).orElseThrow();
        CognitiveProfile profile = profiles.forPatient(patientId);
        GardenState garden = gardens.forPatient(patientId);
        Map<String, TargetState> state = profiles.scoringState(profile);

        ProfileSnapshot latest = snapshots.findTopByPatientIdOrderByAtDesc(patientId).orElse(null);
        Map<String, Double> velocities = latest == null ? Map.of() : records.read(latest.getVelocities(), DOUBLES, Map.of());
        Map<String, String> statuses = latest == null ? Map.of() : records.read(latest.getStatuses(), STRINGS, Map.of());

        // The last fourteen snapshots, oldest first, are the sparklines.
        List<ProfileSnapshot> recent = new ArrayList<>(snapshots.findTop14ByPatientIdOrderByAtDesc(patientId));
        Collections.reverse(recent);
        List<Map<String, Double>> recentLevels = recent.stream()
                .map(s -> records.read(s.getLevels(), DOUBLES, Map.<String, Double>of()))
                .toList();

        List<Dto.DomainCard> domains = new ArrayList<>();
        for (String d : DOMAINS) {
            domains.add(card(d, state.get(d), velocities, statuses, recentLevels));
        }
        List<Dto.DomainCard> subs = new ArrayList<>();
        state.forEach((target, t) -> {
            if (!DOMAINS.contains(target) && t.observations() > 0) {
                subs.add(card(target, t, velocities, statuses, recentLevels));
            }
        });

        Dto.MarkerView markers = null;
        if (latest != null && latest.getMarkers() != null) {
            Contract.SessionMarkers m = records.read(latest.getMarkers(), MARKERS, null);
            if (m != null) {
                markers = new Dto.MarkerView(m.workingMemorySpan(), m.inhibitionBreakdownTier(), m.trajectoryPrecisionMs());
            }
        }

        Instant monthAgo = Instant.now().minus(Duration.ofDays(30));
        List<GameSession> month = sessions.findByPatientIdAndStartedAtAfterOrderByStartedAtAsc(patientId, monthAgo);
        Dto.TrendResult voice = biomarkers.computeTrend(patientId);
        Instant lastActive = sessions.findTopByPatientIdOrderByStartedAtDesc(patientId)
                .map(GameSession::getStartedAt)
                .orElse(null);

        return new Dto.DashboardView(
                new Dto.SessionPatient(patient.getId(), patient.getName(), patient.getKinshipTerm(), patient.getLanguageCode()),
                doctor,
                toGardenDto(garden),
                sessions.countByPatientIdAndStartedAtAfter(patientId, Instant.now().minus(Duration.ofDays(7))),
                lastActive,
                domains,
                subs,
                markers,
                alerts.forPatient(patientId, true).stream().map(DashboardService::alertView).toList(),
                moodTrend(patientId),
                heatmap(month),
                voice.points(),
                doctor ? List.of() : grove.forPatient(patientId).stream()
                        .map(m -> new Dto.FamilyPhase(m.getId(), m.getName(), m.getCurrentPhase()))
                        .toList(),
                activity(patientId),
                registry.all().stream()
                        .map(g -> new Dto.GameInfo(g.id(), g.title(), g.primaryDomains(), g.retired()))
                        .toList());
    }

    private Dto.DomainCard card(
            String target,
            TargetState t,
            Map<String, Double> velocities,
            Map<String, String> statuses,
            List<Map<String, Double>> recentLevels) {
        double level = t == null ? 50 : t.level();
        int observations = t == null ? 0 : t.observations();
        double confidence = Math.min(1, observations / 12.0);
        List<Double> spark = recentLevels.stream()
                .map(m -> m.get(target))
                .filter(v -> v != null)
                .map(DashboardService::round1)
                .toList();
        return new Dto.DomainCard(
                target,
                LABEL.getOrDefault(target, target),
                round1(level),
                statuses.getOrDefault(target, "stable"),
                round2(velocities.getOrDefault(target, 0.0)),
                round2(confidence),
                observations,
                spark);
    }

    /** Her journal entries as signals only. Neither the words nor the model's one-line gist leave the database. */
    @Transactional(readOnly = true)
    public List<Dto.SentimentPoint> sentiment(String patientId, int days) {
        Instant since = Instant.now().minus(Duration.ofDays(Math.max(1, Math.min(days, 365))));
        return jdbc.query(
                "select at, valence, arousal, concern_flags::text as flags from journal_signal "
                        + "where patient_id = ? and at > ? order by at",
                (rs, n) -> new Dto.SentimentPoint(
                        rs.getTimestamp("at").toInstant(), rs.getDouble("valence"), rs.getDouble("arousal"),
                        records.read(rs.getString("flags"), new TypeReference<List<String>>() { }, List.<String>of())),
                patientId, java.sql.Timestamp.from(since));
    }

    /** Her levels after each session in the last {@code days} days: the trend chart. */
    @Transactional(readOnly = true)
    public List<Dto.TimePoint> timeseries(String patientId, int days) {
        Instant since = Instant.now().minus(Duration.ofDays(Math.max(1, Math.min(days, 365))));
        return snapshots.findByPatientIdAndAtAfterOrderByAtAsc(patientId, since).stream()
                .map(s -> new Dto.TimePoint(
                        s.getAt(),
                        records.read(s.getLevels(), DOUBLES, Map.of()),
                        records.read(s.getStatuses(), STRINGS, Map.of())))
                .toList();
    }

    /** The latest sessions with what each one said. Never the raw trials. */
    @Transactional(readOnly = true)
    public List<Dto.SessionRow> recentSessions(String patientId, int limit) {
        return sessions.findByPatientIdOrderByStartedAtDesc(patientId, PageRequest.of(0, Math.max(1, Math.min(limit, 100))))
                .stream()
                .map(this::row)
                .toList();
    }

    private Dto.SessionRow row(GameSession s) {
        String title = s.getGameId() == null
                ? registry.of(s.getGameType()).map(GameRegistry.Entry::title).orElse(s.getGameType().name())
                : registry.find(s.getGameId()).map(GameRegistry.Entry::title).orElse(s.getGameId());
        List<ScoreContribution> cs = records.contributionsOf(s, profiles.legacyReadingsOf(s));
        return new Dto.SessionRow(
                s.getId(),
                s.getStartedAt(),
                s.getGameId() == null ? registry.of(s.getGameType()).map(GameRegistry.Entry::id).orElse(null) : s.getGameId(),
                title,
                s.getDurationMs(),
                s.getCompleted() == null ? s.getCompletionRate() >= 0.95 : s.getCompleted(),
                Boolean.TRUE.equals(s.getAbandoned()),
                s.getDifficultyTier(),
                s.getMoodAtStart() == null ? null : s.getMoodAtStart().name(),
                cs.stream()
                        .map(c -> new Dto.ContributionView(
                                c.target(), round1(c.raw()), round2(c.confidence()),
                                c.because() == null || c.because().isBlank() ? "From her completion of the session." : c.because()))
                        .toList(),
                s.getScoringTrust());
    }

    public static Dto.AlertView alertView(Alert a) {
        return new Dto.AlertView(
                a.getId(), a.getKind(), a.getTarget(), a.getSeverity(), a.getMessage(),
                a.getOpenedAt(), a.getLastSeenAt(), a.getResolvedAt(), a.getAcknowledgedAt());
    }

    /* ------------------------------------------------------------ pieces */

    public Dto.GardenDto toGardenDto(GardenState g) {
        return new Dto.GardenDto(
                g.getPatientId(),
                g.getBloomStage(),
                g.getGrowthPoints(),
                g.isRestingPhase(),
                g.getLastActivity(),
                g.getBloomCount());
    }

    /**
     * When she plays, by weekday and hour. The hour is the one on her own clock (the tablet sends it); the weekday
     * is the server's reading of the start time, so a session near midnight can fall on the neighbouring day.
     */
    private List<Dto.ActivityCell> activity(String patientId) {
        Map<Integer, Integer> cells = new TreeMap<>();
        for (GameSession s : sessions.findByPatientIdAndStartedAtAfterOrderByStartedAtAsc(
                patientId, Instant.now().minus(Duration.ofDays(90)))) {
            if (s.getHourOfDay() == null) {
                continue;
            }
            int weekday = s.getStartedAt().atZone(ZoneId.systemDefault()).getDayOfWeek().getValue() - 1;
            cells.merge(weekday * 24 + s.getHourOfDay(), 1, Integer::sum);
        }
        return cells.entrySet().stream()
                .map(e -> new Dto.ActivityCell(e.getKey() / 24, e.getKey() % 24, e.getValue()))
                .toList();
    }

    private List<Dto.MoodPoint> moodTrend(String patientId) {
        return moods.findByPatientIdAndAtAfterOrderByAtAsc(patientId, Instant.now().minus(Duration.ofDays(30)))
                .stream()
                .map(m -> new Dto.MoodPoint(DAY.format(m.getAt()), m.getMood()))
                .toList();
    }

    private List<Dto.HeatPoint> heatmap(List<GameSession> month) {
        Map<String, Long> minutes = new TreeMap<>();
        for (GameSession s : month) {
            minutes.merge(DAY.format(s.getStartedAt()), Math.round(s.getDurationMs() / 60000d), Long::sum);
        }
        Map<String, Long> ordered = new LinkedHashMap<>(minutes);
        return ordered.entrySet().stream().map(e -> new Dto.HeatPoint(e.getKey(), e.getValue())).toList();
    }

    private static double round1(double v) {
        return Math.round(v * 10d) / 10d;
    }

    private static double round2(double v) {
        return Math.round(v * 100d) / 100d;
    }
}
