package org.smaran.service;

import lombok.extern.slf4j.Slf4j;
import org.smaran.domain.Caregiver;
import org.smaran.domain.FamilyMember;
import org.smaran.domain.Patient;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.stereotype.Service;

/**
 * Everything that leaves the building to reach a human.
 *
 * Three channels, three very different tones:
 *
 *   · WebSocket to the family — "Ma's lotus bloomed 🌸". Delight, immediate.
 *   · FCM push to her tablet — a reminder, silent, with a photograph of the pill.
 *   · SMS to the caregiver — three missed days, a language regression, a motor
 *     variance spike. Never sent to the patient, never about a single bad day.
 *
 * FCM and Twilio are behind this one class deliberately. Both are swapped in by
 * adding the SDK and filling in the two marked methods; until then the calls are
 * logged, so the whole loop is exercisable in a demo with no vendor accounts.
 */
@Service
@Slf4j
public class NotificationService {

    private final SimpMessagingTemplate messaging;

    @Value("${smaran.notifications.fcm-key:}")
    private String fcmKey;

    @Value("${smaran.notifications.twilio-sid:}")
    private String twilioSid;

    public NotificationService(SimpMessagingTemplate messaging) {
        this.messaging = messaging;
    }

    /**
     * A bloom. Goes to every family member watching this patient's topic, in
     * real time — this is the moment the co-op loop turns.
     */
    public void bloom(Patient patient, int bloomStage, boolean milestone) {
        String message = milestone
                ? "%s's garden reached a new stage 🌸".formatted(patient.getName())
                : "%s's lotus bloomed 🌸".formatted(patient.getName());
        messaging.convertAndSend(
                "/topic/family/" + patient.getId(),
                new BloomEvent(patient.getId(), bloomStage, milestone, message));
        log.info("bloom → family of {} (stage {}, milestone {})", patient.getId(), bloomStage, milestone);
    }

    /**
     * She recognised someone. That person is told, and asked to record a new
     * five-second voice note — which is what she will hear next time.
     */
    public void recognised(Patient patient, FamilyMember member) {
        messaging.convertAndSend(
                "/topic/family/" + patient.getId(),
                new RecognisedEvent(
                        member.getId(),
                        member.getName(),
                        "%s knew you today. Would you record something for her?".formatted(patient.getName())));
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
    public void smsCaregiver(Caregiver caregiver, String message) {
        if (twilioSid.isBlank() || caregiver.getPhone() == null) {
            log.info("[twilio not configured] sms → {}: {}", caregiver.getEmail(), message);
            return;
        }
        // TODO(pilot): Twilio Message.creator(...).create()
        log.info("sms → {}: {}", caregiver.getPhone(), message);
    }

    public record BloomEvent(String patientId, int bloomStage, boolean milestone, String message) {
    }

    public record RecognisedEvent(String memberId, String memberName, String message) {
    }
}
