package org.smaran.service;

import java.time.Duration;
import java.time.Instant;
import java.util.List;
import lombok.extern.slf4j.Slf4j;
import org.smaran.domain.Enums.GameType;
import org.smaran.domain.GardenState;
import org.smaran.domain.Patient;
import org.smaran.repo.CaregiverRepository;
import org.smaran.repo.GardenStateRepository;
import org.smaran.repo.PatientRepository;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * The Heritage Garden.
 *
 * This service is the whole progression system, and it is defined as much by
 * what it refuses to do as by what it does:
 *
 *   · growthPoints only ever increases. There is no decrement anywhere.
 *   · a missed day sets restingPhase. Nothing wilts, nothing resets, nothing is
 *     lost, and the patient is never told she missed anything.
 *   · the caregiver hears about it after three consecutive days, once.
 *
 * The arithmetic below is a deliberate duplicate of frontend/src/lib/gardenEngine.ts
 * so that a tablet offline for a week blooms identically to the server. If you
 * change a threshold here, change it there in the same commit.
 */
@Service
@Slf4j
public class GardenStateService {

    /** bare soil · bamboo shoots · orchids · full grove */
    private static final int[] STAGE_THRESHOLDS = {0, 6, 16, 32};

    private final GardenStateRepository gardens;
    private final PatientRepository patients;
    private final CaregiverRepository caregivers;
    private final NotificationService notifications;

    public GardenStateService(
            GardenStateRepository gardens,
            PatientRepository patients,
            CaregiverRepository caregivers,
            NotificationService notifications) {
        this.gardens = gardens;
        this.patients = patients;
        this.caregivers = caregivers;
        this.notifications = notifications;
    }

    public GardenState forPatient(String patientId) {
        return gardens.findById(patientId).orElseGet(() -> {
            GardenState fresh = new GardenState();
            fresh.setPatientId(patientId);
            return gardens.save(fresh);
        });
    }

    /** Completing anything waters the garden. Completing it well waters more. */
    static int growthFor(GameType type, double completionRate) {
        int base = switch (type) {
            // The emotional core earns a little more than the others.
            case FAMILY_GROVE -> 3;
            default -> 2;
        };
        // Floor of one: showing up is itself worth something.
        return Math.max(1, (int) Math.round(base * Math.max(0.5, completionRate)));
    }

    static int stageFor(int growthPoints) {
        for (int stage = 4; stage >= 1; stage--) {
            if (growthPoints >= STAGE_THRESHOLDS[stage - 1]) {
                return stage;
            }
        }
        return 1;
    }

    /**
     * Water the garden after a session. Returns the new state; fires the family
     * WebSocket, and fires it louder when a stage boundary was crossed.
     */
    @Transactional
    public GardenState computeGrowth(String patientId, GameType gameType, double completionRate) {
        GardenState state = forPatient(patientId);
        int before = stageFor(state.getGrowthPoints());

        state.setGrowthPoints(state.getGrowthPoints() + growthFor(gameType, completionRate));
        state.setBloomStage(stageFor(state.getGrowthPoints()));
        state.setBloomCount(state.getBloomCount() + 1);
        state.setRestingPhase(false);
        state.setLastActivity(Instant.now());
        gardens.save(state);

        boolean milestone = state.getBloomStage() > before;
        patients.findById(patientId).ifPresent(p -> notifications.bloom(p, state.getBloomStage(), milestone));
        return state;
    }

    /**
     * Recompute from the full session history rather than from a queue of
     * events. This is what makes offline sync safe: replaying a duplicate batch
     * cannot inflate the garden, because the garden is derived, not accumulated.
     */
    @Transactional
    public GardenState recomputeFrom(String patientId, List<SessionFact> sessions) {
        GardenState state = forPatient(patientId);
        int points = 0;
        Instant last = null;
        for (SessionFact s : sessions) {
            points += growthFor(s.gameType(), s.completionRate());
            if (last == null || s.startedAt().isAfter(last)) {
                last = s.startedAt();
            }
        }
        state.setGrowthPoints(points);
        state.setBloomStage(stageFor(points));
        state.setBloomCount(sessions.size());
        if (last != null) {
            state.setLastActivity(last);
            state.setRestingPhase(Duration.between(last, Instant.now()).toDays() >= 1);
        }
        return gardens.save(state);
    }

    public static long daysSince(Instant instant) {
        return instant == null ? 0 : Duration.between(instant, Instant.now()).toDays();
    }

    /**
     * The nightly sweep. Two things happen here and nothing else: gardens with
     * no activity yesterday go to sleep in the moonlight, and caregivers of
     * gardens asleep for three days get one message.
     */
    @Scheduled(cron = "${smaran.garden.rest-sweep-cron:0 5 2 * * *}")
    @Transactional
    public void restSweep() {
        List<GardenState> stale = gardens.findByLastActivityBefore(Instant.now().minus(Duration.ofDays(1)));
        for (GardenState state : stale) {
            if (!state.isRestingPhase()) {
                state.setRestingPhase(true);
                gardens.save(state);
            }

            long missed = daysSince(state.getLastActivity());
            if (missed < 3) {
                continue;
            }
            // Once per stretch of absence, not once per night.
            if (state.getLastCaregiverAlert() != null
                    && state.getLastCaregiverAlert().isAfter(state.getLastActivity())) {
                continue;
            }

            Patient patient = patients.findById(state.getPatientId()).orElse(null);
            if (patient == null || patient.getCaregiverId() == null) {
                continue;
            }
            caregivers.findById(patient.getCaregiverId()).ifPresent(c -> notifications.smsCaregiver(
                    c,
                    "%s has not opened Smaran for %d days. Her garden is resting — nothing is lost."
                            .formatted(patient.getName(), missed)));
            state.setLastCaregiverAlert(Instant.now());
            gardens.save(state);
            log.info("caregiver alerted: {} missed {} days", patient.getId(), missed);
        }
    }

    /** The minimum a recompute needs to know about a session. */
    public record SessionFact(GameType gameType, double completionRate, Instant startedAt) {
    }
}
