package org.smaran.service;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.ArrayList;
import java.util.Optional;
import lombok.extern.slf4j.Slf4j;
import org.smaran.domain.GameSession;
import org.smaran.repo.GameSessionRepository;
import org.smaran.scoring.Contract.ScoreContribution;
import org.smaran.scoring.SundowningDetector;
import org.smaran.domain.Alert;
import org.smaran.domain.Patient;
import org.smaran.repo.AlertRepository;
import org.smaran.repo.PatientRepository;
import org.smaran.scoring.CognitiveScoringService;
import org.smaran.scoring.Contract.AlertRule;
import org.smaran.scoring.Contract.AlertSeverity;
import org.smaran.scoring.Contract.Reading;
import org.smaran.scoring.Contract.Status;
import org.smaran.scoring.Contract.TargetState;
import org.springframework.http.HttpStatus;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

/**
 * Alerts: {@code DOMAIN_DECLINE} and {@code MISSED_DAYS}.
 *
 * Each is phrased as an observation with its evidence, never a conclusion: the
 * person reading it is a daughter on a train, and the next step is always
 * "mention this to the doctor", never "your mother has X".
 *
 * <b>Episodes, not events.</b> An alert is open from the first session that
 * meets the rule until a session says the pattern has ended. A continuing
 * episode updates its row (and may be raised from watch to decline); it never
 * adds a second one. That is what "idempotent" means here, and the database
 * enforces it with a unique index on the open row.
 *
 * <b>DOMAIN_DECLINE</b> follows the configured rule (TWO_CONSECUTIVE by default,
 * SINGLE or CUSUM), with confidence gating: until a domain has enough readings
 * to trust (domain confidence 0.35), nothing is raised. The engine decides;
 * this class records.
 *
 * <b>MISSED_DAYS</b> opens once, when she has not played for three days, and
 * ends the next time she plays. A quiet day or two is a resting garden.
 */
@Service
@Slf4j
public class AlertService {

    public static final Duration MISSED_AFTER = Duration.ofDays(3);

    private static final Map<String, String> LABEL = Map.ofEntries(
            Map.entry("LANGUAGE", "language"),
            Map.entry("VISUAL_SEMANTIC", "recognising pictures and faces"),
            Map.entry("MOTOR", "movement and tapping"),
            Map.entry("AFFECTIVE", "mood and feeling"),
            Map.entry("TEMPORAL", "knowing the order of the day"),
            Map.entry("EXECUTIVE", "planning and holding things in mind"),
            Map.entry("WORKING_MEMORY_SPAN", "holding a few things in mind at once"),
            Map.entry("INHIBITORY_CONTROL", "holding back a reaction"),
            Map.entry("COGNITIVE_FLEXIBILITY", "switching between things"),
            Map.entry("TRAJECTORY_PREDICTION", "following something that moves"),
            Map.entry("REACTION_SPEED", "reaction speed"),
            Map.entry("SUSTAINED_ATTENTION", "staying with a task"));

    private final AlertRepository alerts;
    private final GameSessionRepository sessions;
    private final SessionRecords records;
    private final CognitiveProfileService profiles;
    private final PatientRepository patients;
    private final CognitiveScoringService scoring;
    private final DashboardEvents events;
    private final Clock clock;

    public AlertService(
            AlertRepository alerts,
            GameSessionRepository sessions,
            SessionRecords records,
            CognitiveProfileService profiles,
            PatientRepository patients,
            CognitiveScoringService scoring,
            DashboardEvents events,
            Clock clock) {
        this.alerts = alerts;
        this.sessions = sessions;
        this.records = records;
        this.profiles = profiles;
        this.patients = patients;
        this.scoring = scoring;
        this.events = events;
        this.clock = clock;
    }

    /* ------------------------------------------------------ domain decline */

    /**
     * Look at what a session (or, after a rebuild, the end state) says about each
     * target, and open, raise or end that target's episode.
     *
     * @param state the engine state after these readings, for the length of the run
     */
    @Transactional
    public void observe(String patientId, Map<String, TargetState> state, List<Reading> readings, Instant at) {
        for (Reading r : readings) {
            Optional<Alert> open = alerts.findByPatientIdAndKindAndTargetAndResolvedAtIsNull(
                    patientId, Alert.DOMAIN_DECLINE, r.target());
            if (r.alert() != null) {
                String severity = r.alert() == AlertSeverity.DECLINE ? "decline" : "watch";
                String message = declineMessage(r, state.get(r.target()), severity);
                if (open.isPresent()) {
                    Alert a = open.get();
                    boolean raised = "watch".equals(a.getSeverity()) && "decline".equals(severity);
                    a.setSeverity("decline".equals(a.getSeverity()) ? "decline" : severity);
                    a.setMessage(message);
                    a.setLastSeenAt(at);
                    alerts.save(a);
                    if (raised) {
                        events.publish(patientId, "alert", Map.of("id", a.getId(), "kind", a.getKind(), "severity", a.getSeverity()));
                    }
                } else {
                    Alert a = open(patientId, Alert.DOMAIN_DECLINE, r.target(), severity, message, at);
                    log.info("alert {} opened for {}: {} {}", a.getId(), patientId, a.getKind(), a.getTarget());
                }
            } else if (open.isPresent() && (r.status() == Status.STABLE || r.status() == Status.IMPROVING)) {
                // The pattern has ended: she is back to her own usual.
                end(open.get(), at);
            }
        }
    }

    private String declineMessage(Reading r, TargetState state, String severity) {
        String what = LABEL.getOrDefault(r.target(), r.target().toLowerCase());
        AlertRule rule = scoring.config().alertRule();
        int run = state == null ? 0 : "decline".equals(severity) ? state.runDecline() : state.runWatch();
        String pattern = switch (rule) {
            case CUSUM -> "have drifted down steadily over recent sessions";
            case SINGLE -> "were lower than her own usual in her latest session";
            case TWO_CONSECUTIVE -> run >= 2
                    ? "have been %s her own usual for %d sessions in a row".formatted(
                            "decline".equals(severity) ? "well below" : "below", run)
                    : "were below her own usual in her latest sessions";
        };
        return ("Her %s scores %s. This is a pattern in how she played, not a diagnosis. "
                + "One or two lower days are normal; if it continues, it is worth mentioning at the next appointment.")
                .formatted(what, pattern);
    }

    /* ---------------------------------------------------------- sundowning */

    /**
     * Compare her late-afternoon sittings with her mornings over the last month (see
     * {@link SundowningDetector}), and open, update or end the episode. Called after a
     * session is stored; cheap enough for that, since it reads one month of one patient.
     */
    @Transactional
    public void observeSundowning(String patientId, Instant now) {
        List<SundowningDetector.Sitting> sittings = new ArrayList<>();
        for (GameSession s : sessions.findByPatientIdAndStartedAtAfterOrderByStartedAtAsc(
                patientId, now.minus(Duration.ofDays(30)))) {
            if (s.getHourOfDay() == null || s.getGameId() == null) {
                continue;
            }
            List<ScoreContribution> cs = records.contributionsOf(s, profiles.legacyReadingsOf(s));
            double weight = cs.stream().mapToDouble(ScoreContribution::confidence).sum();
            if (weight <= 0) {
                continue;
            }
            double score = cs.stream().mapToDouble(c -> c.raw() * c.confidence()).sum() / weight;
            sittings.add(new SundowningDetector.Sitting(s.getGameId(), s.getHourOfDay(), score));
        }
        SundowningDetector.Verdict v = SundowningDetector.evaluate(sittings);
        Optional<Alert> open = alerts.findByPatientIdAndKindAndTargetAndResolvedAtIsNull(patientId, Alert.SUNDOWNING, "");
        if (v.flagged()) {
            String message = ("Her sittings between 3 and 7 in the evening have been scoring lower than her mornings: "
                    + "a gap of about %.1f times her usual variation, over %d afternoon and %d morning sittings this month. "
                    + "A late-day dip is something some people with dementia have, and it is worth mentioning to her doctor. "
                    + "This is a pattern in how she played, not a diagnosis.")
                    .formatted(v.effectSize(), v.lateAfternoon(), v.morning());
            if (open.isPresent()) {
                Alert a = open.get();
                a.setMessage(message);
                a.setLastSeenAt(now);
                alerts.save(a);
            } else {
                open(patientId, Alert.SUNDOWNING, "", "watch", message, now);
            }
        } else if (open.isPresent() && v.clear()) {
            end(open.get(), now);
        }
    }

    /* --------------------------------------------------------- missed days */

    /**
     * She played, so a MISSED_DAYS episode ends. Only the latest session counts: a
     * late-arriving old one says nothing about whether she is playing now.
     */
    @Transactional
    public void sawActivity(String patientId, Instant latestSessionAt, Instant now) {
        if (latestSessionAt.isAfter(now.minus(MISSED_AFTER))) {
            alerts.findByPatientIdAndKindAndTargetAndResolvedAtIsNull(patientId, Alert.MISSED_DAYS, "")
                    .ifPresent(a -> end(a, now));
        }
    }

    /** Hourly: anyone whose last session is over three days old and who has no open episode gets one. */
    @Scheduled(fixedRate = 3_600_000, initialDelay = 120_000)
    public void checkMissedDaysNow() {
        try {
            checkMissedDays(clock.instant());
        } catch (RuntimeException e) {
            log.warn("missed-days check failed: {}", e.getMessage());
        }
    }

    @Transactional
    public int checkMissedDays(Instant now) {
        int opened = 0;
        for (String patientId : alerts.patientsQuietSince(now.minus(MISSED_AFTER))) {
            if (alerts.findByPatientIdAndKindAndTargetAndResolvedAtIsNull(patientId, Alert.MISSED_DAYS, "").isPresent()) {
                continue;
            }
            Patient patient = patients.findById(patientId).orElse(null);
            if (patient == null) {
                continue;
            }
            String first = patient.getName() == null || patient.getName().isBlank()
                    ? "She"
                    : patient.getName().strip().split("\\s+")[0];
            open(patientId, Alert.MISSED_DAYS, "", "watch",
                    "%s has not played for three days. Her garden is resting and nothing has been lost, but a call may be welcome."
                            .formatted(first),
                    now);
            opened++;
        }
        return opened;
    }

    /* ------------------------------------------------------------- reading */

    public List<Alert> forPatient(String patientId, boolean openOnly) {
        return openOnly
                ? alerts.findByPatientIdAndResolvedAtIsNullOrderByOpenedAtDesc(patientId)
                : alerts.findByPatientIdOrderByOpenedAtDesc(patientId);
    }

    /** Someone has seen it. The alert stays in the record, and stays open if the pattern continues. */
    @Transactional
    public Alert acknowledge(String patientId, String alertId, String userId) {
        Alert a = alerts.findByIdAndPatientId(alertId, patientId)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND));
        if (a.getAcknowledgedAt() == null) {
            a.setAcknowledgedAt(clock.instant());
            a.setAcknowledgedBy(userId);
            alerts.save(a);
        }
        return a;
    }

    /* ------------------------------------------------------------ plumbing */

    private Alert open(String patientId, String kind, String target, String severity, String message, Instant at) {
        Alert a = new Alert();
        a.setPatientId(patientId);
        a.setKind(kind);
        a.setTarget(target);
        a.setSeverity(severity);
        a.setMessage(message);
        a.setOpenedAt(at);
        a.setLastSeenAt(at);
        alerts.save(a);
        events.publish(patientId, "alert", Map.of("id", a.getId(), "kind", kind, "severity", severity));
        return a;
    }

    private void end(Alert a, Instant at) {
        a.setResolvedAt(at);
        a.setLastSeenAt(at);
        alerts.save(a);
        events.publish(a.getPatientId(), "alert", Map.of("id", a.getId(), "kind", a.getKind(), "resolved", true));
    }
}
