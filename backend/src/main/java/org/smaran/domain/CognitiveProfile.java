package org.smaran.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import org.smaran.domain.Enums.MotorTier;
import org.smaran.domain.Enums.PeakWindow;

/**
 * The living document.
 *
 * Onboarding writes version 1.0 without asking a clinical question; every
 * session amends it. `domainScores` and `clusterAccuracy` are stored as JSON
 * rather than columns because the set of semantic clusters is caregiver-defined
 * and must be able to grow without a migration.
 */
@Entity
@Table(name = "cognitive_profile")
@Getter
@Setter
@NoArgsConstructor
public class CognitiveProfile {

    @Id
    private String patientId;

    /** {"language":0.74,"visualSemantic":0.55,"motor":0.66,...} */
    @Column(columnDefinition = "text", nullable = false)
    private String domainScores = "{}";

    /** {"MUSICAL":0.55,"NATURE":0.82,...} — per-cluster recognition accuracy. */
    @Column(columnDefinition = "text", nullable = false)
    private String clusterAccuracy = "{}";

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    private MotorTier motorTier = MotorTier.MODERATE;

    /**
     * Derived behaviourally from hesitation, mid-session pauses, voice-hint
     * replays and abandoned sessions. Never self-reported. A load score above
     * this eases the session, silently.
     */
    @Column(nullable = false)
    private double anxietyThreshold = 0.72;

    /** Family Grove phase a newly added member starts at. */
    @Column(nullable = false)
    private int startingPhase = 1;

    /** Late-afternoon mood dip. When true, no game reminders after 16:00. */
    @Column(nullable = false)
    private boolean sundowningPattern = false;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    private PeakWindow selfReportedPeak = PeakWindow.MORNING;

    /** Where she actually performs best. It often differs from the above. */
    @Enumerated(EnumType.STRING)
    private PeakWindow derivedPeak;

    @Column(nullable = false)
    private String version = "1.0";

    private Instant updatedAt = Instant.now();
}
