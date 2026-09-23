package org.smaran.service;

import java.time.Instant;
import java.util.List;
import lombok.extern.slf4j.Slf4j;
import org.smaran.domain.FamilyMember;
import org.smaran.repo.FamilyMemberRepository;
import org.smaran.repo.PatientRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Per-member phase progression for Family Grove.
 *
 * The rule that makes this game humane: **phase belongs to the relationship,
 * not to the patient.** She may recall her daughter without any prompt and
 * still need a cousin's name printed under his face, and a single global phase
 * would make the game wrong for everyone except whoever it was tuned to.
 *
 *   1 Introduction    names visible on every fruit
 *   2 Recognition     initials only
 *   3 Identification  a question and choice cards
 *   4 Recall          no cards; she touches the tree
 *
 * Advancing takes three consecutive correct recognitions. Slipping back takes a
 * single miss — and that is not a punishment, it is the errorless-learning
 * model working: the moment something is hard, it gets easier immediately.
 */
@Service
@Slf4j
public class FamilyGroveAdaptationService {

    private static final int ADVANCE_STREAK = 3;

    private final FamilyMemberRepository members;
    private final PatientRepository patients;
    private final NotificationService notifications;

    public FamilyGroveAdaptationService(
            FamilyMemberRepository members, PatientRepository patients, NotificationService notifications) {
        this.members = members;
        this.patients = patients;
        this.notifications = notifications;
    }

    public List<FamilyMember> forPatient(String patientId) {
        return members.findByPatientIdOrderByCurrentPhaseDesc(patientId);
    }

    public int getPhase(String patientId, String memberId) {
        return members.findById(memberId)
                .filter(m -> m.getPatientId().equals(patientId))
                .map(FamilyMember::getCurrentPhase)
                .orElse(1);
    }

    /**
     * Record one answer. Correct answers tell the family member, who is then
     * asked to record a new five-second voice note — which is the content she
     * hears next time. That is the co-op loop, and it closes here.
     */
    @Transactional
    public FamilyMember recordResult(String patientId, String memberId, boolean correct, long latencyMs) {
        FamilyMember member = members.findById(memberId).orElseThrow();
        if (!member.getPatientId().equals(patientId)) {
            throw new IllegalArgumentException("member does not belong to this patient");
        }

        if (correct) {
            member.setCorrectStreak(member.getCorrectStreak() + 1);
            member.setLastRecognisedAt(Instant.now());

            // A slow correct answer is still a correct answer, but it is not
            // yet fluent — do not climb on the back of a ten-second pause.
            boolean fluent = latencyMs > 0 && latencyMs < 8000;
            if (member.getCorrectStreak() >= ADVANCE_STREAK && fluent && member.getCurrentPhase() < 4) {
                member.setCurrentPhase(member.getCurrentPhase() + 1);
                member.setCorrectStreak(0);
                log.info("grove: {} advanced to phase {}", member.getName(), member.getCurrentPhase());
            }

            patients.findById(patientId).ifPresent(p -> notifications.recognised(p, member));
        } else {
            member.setCorrectStreak(0);
            if (member.getCurrentPhase() > 1) {
                // Down one, immediately. She should not meet the same wall twice.
                member.setCurrentPhase(member.getCurrentPhase() - 1);
            }
        }

        return members.save(member);
    }

    /**
     * A newly added family member starts at the profile's starting phase, not
     * at whatever phase the rest of the tree has reached.
     */
    @Transactional
    public FamilyMember add(FamilyMember member, int startingPhase) {
        member.setCurrentPhase(Math.max(1, Math.min(4, startingPhase)));
        return members.save(member);
    }
}
