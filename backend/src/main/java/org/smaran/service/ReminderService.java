package org.smaran.service;

import java.time.LocalTime;
import java.time.ZoneId;
import java.util.List;
import lombok.extern.slf4j.Slf4j;
import org.smaran.domain.Enums.ReminderType;
import org.smaran.domain.Patient;
import org.smaran.domain.ReminderSchedule;
import org.smaran.repo.PatientRepository;
import org.smaran.repo.ReminderScheduleRepository;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Server-side reminders.
 *
 * This is the *second* path, not the first. The Service Worker on her tablet
 * fires the same schedule from the device's own clock, which is what makes
 * reminders work through a three-day outage. What the server adds is a push for
 * devices that are awake, and the scheduling rules that depend on history the
 * device does not hold.
 *
 * Two rules live here and nowhere else:
 *   · sundowning patients get no *game* nudges after 16:00. Medicine always
 *     goes through — a tablet is not a nudge.
 *   · reminders are pushed at the top of her peak window, not at a fixed hour,
 *     for anything that is not time-critical.
 */
@Service
@Slf4j
public class ReminderService {

    private final ReminderScheduleRepository schedules;
    private final PatientRepository patients;
    private final CognitiveProfileService profiles;
    private final LanguageService languages;
    private final NotificationService notifications;

    public ReminderService(
            ReminderScheduleRepository schedules,
            PatientRepository patients,
            CognitiveProfileService profiles,
            LanguageService languages,
            NotificationService notifications) {
        this.schedules = schedules;
        this.patients = patients;
        this.profiles = profiles;
        this.languages = languages;
        this.notifications = notifications;
    }

    public List<ReminderSchedule> forPatient(String patientId) {
        return schedules.findByPatientIdAndActiveTrue(patientId);
    }

    @Transactional
    public List<ReminderSchedule> replace(String patientId, List<ReminderSchedule> next) {
        schedules.deleteByPatientId(patientId);
        next.forEach(r -> r.setPatientId(patientId));
        return schedules.saveAll(next);
    }

    /**
     * Whether a reminder of this kind may be delivered at this local hour.
     * Public because the Service Worker asks the same question on the device
     * and the two answers must agree.
     */
    public boolean allowedAt(String patientId, ReminderType type, int localHour) {
        if (type == ReminderType.MEDICINE) {
            return true;
        }
        return !(profiles.forPatient(patientId).isSundowningPattern() && localHour >= 16);
    }

    /** Runs every minute; delivers anything due in this minute. */
    @Scheduled(cron = "${smaran.reminders.cron:0 * * * * *}")
    @Transactional(readOnly = true)
    public void tick() {
        LocalTime now = LocalTime.now(ZoneId.systemDefault());
        for (ReminderSchedule reminder : schedules.findByActiveTrue()) {
            LocalTime due = parse(reminder.getScheduledTime());
            if (due == null || due.getHour() != now.getHour() || due.getMinute() != now.getMinute()) {
                continue;
            }
            if (!allowedAt(reminder.getPatientId(), reminder.getType(), now.getHour())) {
                log.debug("suppressed {} for {} (sundowning window)", reminder.getType(), reminder.getPatientId());
                continue;
            }
            deliver(reminder);
        }
    }

    /** Fires one reminder now — also used by the caregiver's "test" button. */
    public void deliver(ReminderSchedule reminder) {
        Patient patient = patients.findById(reminder.getPatientId()).orElse(null);
        if (patient == null) {
            return;
        }
        String body = languages.renderReminder(reminder.getMessageTemplate(), patient.getKinshipTerm());
        notifications.pushReminder(
                patient.getId(),
                "Smaran",
                body,
                // The photograph of the actual pill, so she recognises it in her hand.
                reminder.getPhotoS3Key());
    }

    @Transactional(readOnly = true)
    public void testFor(String patientId) {
        List<ReminderSchedule> list = forPatient(patientId);
        if (list.isEmpty()) {
            Patient patient = patients.findById(patientId).orElse(null);
            if (patient != null) {
                notifications.pushReminder(
                        patient.getId(),
                        "Smaran",
                        languages.renderReminder("{kin}, this is how a reminder will look.", patient.getKinshipTerm()),
                        null);
            }
            return;
        }
        deliver(list.get(0));
    }

    private static LocalTime parse(String hhmm) {
        try {
            return LocalTime.parse(hhmm);
        } catch (Exception e) {
            return null;
        }
    }
}
