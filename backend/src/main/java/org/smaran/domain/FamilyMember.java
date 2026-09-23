package org.smaran.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

/**
 * Someone she loves, hanging as fruit on the tree.
 *
 * `currentPhase` advances **per member**. She may recall her daughter without a
 * prompt and still need a cousin's name on screen, and holding one phase for the
 * whole family would make the game wrong for every member but one.
 */
@Entity
@Table(name = "family_member")
@Getter
@Setter
@NoArgsConstructor
public class FamilyMember {

    @Id
    private String id = UUID.randomUUID().toString();

    @Column(name = "patient_id", nullable = false)
    private String patientId;

    @Column(nullable = false)
    private String name;

    private String relationship;

    /** What she calls them, in her own tongue. */
    private String kinshipTermLocal;

    private String photoS3Key;

    /** Five seconds of a familiar voice — the highest-value field in setup. */
    private String voiceNoteS3Key;

    /** One specific memory, read aloud when she hesitates. */
    @Column(columnDefinition = "text")
    private String contextHint;

    /** 1 Introduction · 2 Recognition · 3 Identification · 4 Recall */
    @Column(nullable = false)
    private int currentPhase = 1;

    /** Consecutive correct recognitions. Three in a row advances the phase. */
    @Column(nullable = false)
    private int correctStreak = 0;

    /** Contact for the co-op loop: they are told when she recognises them. */
    private String notifyToken;

    private Instant lastRecognisedAt;
}
