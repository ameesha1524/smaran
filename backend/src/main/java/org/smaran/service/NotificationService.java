package org.smaran.service;

import java.util.Map;
import lombok.extern.slf4j.Slf4j;
import org.smaran.domain.AppUser;
import org.smaran.domain.FamilyMember;
import org.smaran.domain.Patient;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

/**
 * Everything that leaves the building to reach a human.
 *
 * Three channels, three very different tones:
 *
 *   · the dashboard stream to the family: "her lotus bloomed". Delight, immediate.
 *     This used to be an open WebSocket anyone could subscribe to; it is now the
 *     same authorised event stream the dashboards use, so only people who may
 *     read her dashboard hear it, and what they hear is an id, not a sentence.
 *   · FCM push to her tablet: a reminder, silent, with a photograph of the pill.
 *   · SMS to the caregiver: three missed days, never about a single bad day.
 *
 * FCM and Twilio are behind this one class deliberately. Both are swapped in by
 * adding the SDK and filling in the two marked methods; until then the calls are
 * logged, so the whole loop is exercisable in a demo with no vendor accounts.
 */
@Service
@Slf4j
public class NotificationService {

    private final DashboardEvents events;

    @Value("${smaran.notifications.fcm-key:}")
    private String fcmKey;

    @Value("${smaran.notifications.twilio-sid:}")
    private String twilioSid;

    public NotificationService(DashboardEvents events) {
        this.events = events;
    }

    /** A bloom. Goes to every family member watching this patient's dashboard, in real time. */
    public void bloom(Patient patient, int bloomStage, boolean milestone) {
        events.publish(patient.getId(), "bloom", Map.of("bloomStage", bloomStage, "milestone", milestone));
        log.info("bloom → family of {} (stage {}, milestone {})", patient.getId(), bloomStage, milestone);
    }

    /**
     * She recognised someone. That person is told, and asked to record a new
     * five-second voice note — which is what she will hear next time.
     */
    public void recognised(Patient patient, FamilyMember member) {
        events.publish(patient.getId(), "recognised", Map.of("memberId", member.getId()));
        log.info("recognition → {} ({} of {})", member.getName(), member.getRelationship(), patient.getId());
    }

    /** A reminder to her tablet. Silent by design; the app plays a wind chime. */
    public void pushReminder(String deviceToken, String title, String body, String imageUrl) {
        if (fcmKey.isBlank() || deviceToken == null) {
            log.info("[fcm not configured] push → {}: {}", deviceToken, body);
            return;
        }
        // TODO(pilot): FirebaseMessaging.getInstance().send(...) with the pill
        // photograph as the notification image and no sound.
        log.info("push → {}: {} ({})", deviceToken, body, imageUrl);
    }

    /**
     * The caregiver alert. Note the threshold this is called behind: three
     * consecutive missed days, not one. A quiet day is a resting day.
     */
    public void smsCaregiver(AppUser caregiver, String message) {
        if (twilioSid.isBlank() || caregiver.getPhone() == null) {
            log.info("[twilio not configured] sms → {}: {}", caregiver.getEmail(), message);
            return;
        }
        // TODO(pilot): Twilio Message.creator(...).create()
        log.info("sms → {}: {}", caregiver.getPhone(), message);
    }
}
