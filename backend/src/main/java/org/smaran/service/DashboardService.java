package org.smaran.service;

import java.time.Duration;
import java.time.Instant;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;
import org.smaran.domain.CognitiveProfile;
import org.smaran.domain.Enums.AlertLevel;
import org.smaran.domain.Enums.GameType;
import org.smaran.domain.GameSession;
import org.smaran.domain.GardenState;
import org.smaran.domain.Patient;
import org.smaran.repo.GameSessionRepository;
import org.smaran.repo.MoodLogRepository;
import org.smaran.repo.PatientRepository;
import org.smaran.web.Dto;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Everything the caregiver dashboard shows, assembled in one read.
 *
 * The alerts at the bottom are the reason this service exists. Each one is
 * phrased as an observation with its evidence attached, never as a conclusion,
 * because the person reading it is a daughter on a train and the next step is
 * always "mention this to the doctor", never "your mother has X".
 */
@Service
public class DashboardService {

    private static final DateTimeFormatter DAY =
            DateTimeFormatter.ofPattern("yyyy-MM-dd").withZone(ZoneId.systemDefault());

    private final PatientRepository patients;
    private final GameSessionRepository sessions;
    private final MoodLogRepository moods;
    private final CognitiveProfileService profiles;
    private final GardenStateService gardens;
    private final FamilyGroveAdaptationService grove;
    private final AudioBiomarkerService biomarkers;

    public DashboardService(
            PatientRepository patients,
            GameSessionRepository sessions,
            MoodLogRepository moods,
            CognitiveProfileService profiles,
            GardenStateService gardens,
            FamilyGroveAdaptationService grove,
            AudioBiomarkerService biomarkers) {
        this.patients = patients;
        this.sessions = sessions;
        this.moods = moods;
        this.profiles = profiles;
        this.gardens = gardens;
        this.grove = grove;
        this.biomarkers = biomarkers;
    }

    @Transactional(readOnly = true)
    public Dto.DashboardSummary summary(String patientId) {
        Patient patient = patients.findById(patientId).orElseThrow();
        CognitiveProfile profile = profiles.forPatient(patientId);
        GardenState garden = gardens.forPatient(patientId);

        Instant monthAgo = Instant.now().minus(Duration.ofDays(30));
        List<GameSession> month = sessions.findByPatientIdAndStartedAtAfterOrderByStartedAtAsc(patientId, monthAgo);

        Dto.TrendResult voice = biomarkers.computeTrend(patientId);

        return new Dto.DashboardSummary(
                toPatientDto(patient, profile),
                toGardenDto(garden),
                sessions.countByPatientIdAndStartedAtAfter(patientId, Instant.now().minus(Duration.ofDays(7))),
                month.isEmpty() ? garden.getLastActivity() : month.get(month.size() - 1).getStartedAt(),
                moodTrend(patientId),
                domainTrend(month),
                heatmap(month),
                perGame(month),
                grove.forPatient(patientId).stream()
                        .map(m -> new Dto.FamilyPhase(m.getId(), m.getName(), m.getCurrentPhase()))
                        .toList(),
                alerts(patient, profile, garden, month, voice),
                voice.points());
    }

    /* ------------------------------------------------------------ pieces */

    private Dto.PatientDto toPatientDto(Patient p, CognitiveProfile profile) {
        return new Dto.PatientDto(
                p.getId(),
                p.getName(),
                p.getLanguageCode(),
                p.getKinshipTerm(),
                p.getRegion(),
                p.getFaith(),
                p.getPeakWindow(),
                p.getProfileVersion(),
                p.getCaregiverId(),
                profiles.toDto(profile));
    }

    public Dto.GardenDto toGardenDto(GardenState g) {
        return new Dto.GardenDto(
                g.getPatientId(),
                g.getBloomStage(),
                g.getGrowthPoints(),
                g.isRestingPhase(),
                g.getLastActivity(),
                g.getBloomCount());
    }

    private List<Dto.MoodPoint> moodTrend(String patientId) {
        return moods.findByPatientIdAndAtAfterOrderByAtAsc(patientId, Instant.now().minus(Duration.ofDays(30)))
                .stream()
                .map(m -> new Dto.MoodPoint(DAY.format(m.getAt()), m.getMood()))
                .toList();
    }

    /**
     * One point per day per domain. Days with no session inherit the previous
     * day's value rather than dropping to zero — a rest day is not a decline,
     * and a chart that says otherwise would be lying to a frightened relative.
     */
    private List<Dto.DomainPoint> domainTrend(List<GameSession> month) {
        Map<String, Map<String, List<Double>>> byDay = new TreeMap<>();
        for (GameSession s : month) {
            String day = DAY.format(s.getStartedAt());
            String domain = domainOf(s.getGameType());
            byDay.computeIfAbsent(day, d -> new LinkedHashMap<>())
                    .computeIfAbsent(domain, d -> new ArrayList<>())
                    .add(s.getCompletionRate());
        }

        List<Dto.DomainPoint> out = new ArrayList<>();
        Map<String, Double> carry = new LinkedHashMap<>(
                Map.of("language", 0.6, "visualSemantic", 0.6, "motor", 0.6, "affective", 0.7, "temporal", 0.6));

        for (Map.Entry<String, Map<String, List<Double>>> day : byDay.entrySet()) {
            day.getValue().forEach((domain, values) ->
                    carry.put(domain, values.stream().mapToDouble(Double::doubleValue).average().orElse(carry.get(domain))));
            out.add(new Dto.DomainPoint(
                    day.getKey(),
                    carry.get("language"),
                    carry.get("visualSemantic"),
                    carry.get("motor"),
                    carry.get("affective"),
                    carry.get("temporal")));
        }
        return out;
    }

    private List<Dto.HeatPoint> heatmap(List<GameSession> month) {
        Map<String, Long> minutes = new TreeMap<>();
        for (GameSession s : month) {
            minutes.merge(DAY.format(s.getStartedAt()), Math.round(s.getDurationMs() / 60000d), Long::sum);
        }
        return minutes.entrySet().stream().map(e -> new Dto.HeatPoint(e.getKey(), e.getValue())).toList();
    }

    private List<Dto.GamePerformance> perGame(List<GameSession> month) {
        List<Dto.GamePerformance> out = new ArrayList<>();
        for (GameType type : GameType.values()) {
            List<GameSession> forType = month.stream().filter(s -> s.getGameType() == type).toList();
            if (forType.isEmpty()) {
                continue;
            }
            double avg = forType.stream().mapToDouble(GameSession::getCompletionRate).average().orElse(0);
            String trend = "FLAT";
            if (forType.size() >= 4) {
                int half = forType.size() / 2;
                double early = forType.subList(0, half).stream().mapToDouble(GameSession::getCompletionRate).average().orElse(0);
                double late = forType.subList(half, forType.size()).stream().mapToDouble(GameSession::getCompletionRate).average().orElse(0);
                if (late > early + 0.07) {
                    trend = "UP";
                } else if (late < early - 0.07) {
                    trend = "DOWN";
                }
            }
            out.add(new Dto.GamePerformance(type, forType.size(), round(avg), trend));
        }
        out.sort(Comparator.comparingLong(Dto.GamePerformance::sessions).reversed());
        return out;
    }

    /* ------------------------------------------------------------ alerts */

    private List<Dto.DashboardAlertDto> alerts(
            Patient patient,
            CognitiveProfile profile,
            GardenState garden,
            List<GameSession> month,
            Dto.TrendResult voice) {

        List<Dto.DashboardAlertDto> alerts = new ArrayList<>();

        long missed = GardenStateService.daysSince(garden.getLastActivity());
        if (missed >= 3) {
            alerts.add(new Dto.DashboardAlertDto(
                    AlertLevel.ORANGE,
                    "MISSED_DAYS",
                    "%s has not opened Smaran for %d days. Her garden is resting — nothing has been lost, but it may be worth a call."
                            .formatted(patient.getName(), missed)));
        }

        // A cluster falling while its neighbours hold: domain-specific decline.
        Map<String, Double> clusters = profiles.clusters(profile);
        clusters.entrySet().stream()
                .filter(e -> e.getValue() < 0.6)
                .min(Map.Entry.comparingByValue())
                .ifPresent(worst -> {
                    double others = clusters.entrySet().stream()
                            .filter(e -> !e.getKey().equals(worst.getKey()))
                            .mapToDouble(Map.Entry::getValue)
                            .average()
                            .orElse(worst.getValue());
                    if (others - worst.getValue() >= 0.2) {
                        alerts.add(new Dto.DashboardAlertDto(
                                AlertLevel.AMBER,
                                "CLUSTER_DECLINE",
                                ("Recognition of \"%s\" objects is at %d%% while other groups are around %d%%. "
                                        + "A single group falling on its own usually points at a memory domain rather "
                                        + "than at forgetting the culture — worth mentioning at the next appointment.")
                                        .formatted(
                                                worst.getKey().replace('_', ' ').toLowerCase(),
                                                Math.round(worst.getValue() * 100),
                                                Math.round(others * 100))));
                    }
                });

        if (profile.isSundowningPattern()) {
            alerts.add(new Dto.DashboardAlertDto(
                    AlertLevel.YELLOW,
                    "MOTOR_VARIANCE",
                    "Late-afternoon mood has been consistently lower. Smaran has stopped suggesting games after 4 pm."));
        }

        if (voice.rising()) {
            alerts.add(new Dto.DashboardAlertDto(
                    AlertLevel.YELLOW,
                    "VOICE_BIOMARKER",
                    voice.message() + " This is a monitoring signal, not a diagnosis."));
        }

        // Language regression: she is answering in a language other than the one
        // set for her, which can appear under cognitive stress.
        boolean regression = month.stream().anyMatch(s -> s.getCognitiveLoadScore() > 0.85)
                && !patient.getLanguageCode().equals("en")
                && month.size() > 10;
        if (regression) {
            alerts.add(new Dto.DashboardAlertDto(
                    AlertLevel.AMBER,
                    "LANGUAGE_REGRESSION",
                    "Several sessions this month ran at a high cognitive load. If she has been slipping into her "
                            + "childhood language at those moments, note when it happens — it is useful for the doctor."));
        }

        return alerts;
    }

    /* ----------------------------------------------------------- helpers */

    static String domainOf(GameType type) {
        return switch (type) {
            case WEAVERS_LOOM -> "visualSemantic";
            case GRANDMOTHERS_TALE -> "language";
            case FAMILY_GROVE -> "affective";
            case MORNING_RITUALS -> "temporal";
        };
    }

    private static double round(double v) {
        return Math.round(v * 1000d) / 1000d;
    }
}
