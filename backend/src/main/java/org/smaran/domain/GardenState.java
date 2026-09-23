package org.smaran.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

/**
 * The Heritage Garden — what replaces XP, streaks, leaderboards and scores.
 *
 * `growthPoints` only ever increases. There is no column here that can go down,
 * because there is no event in Smaran that takes something away from her.
 * A missed day sets `restingPhase`, which is a state, not a penalty.
 */
@Entity
@Table(name = "garden_state")
@Getter
@Setter
@NoArgsConstructor
public class GardenState {

    @Id
    private String patientId;

    /** 1 bare soil · 2 bamboo shoots · 3 orchids · 4 full grove */
    @Column(nullable = false)
    private int bloomStage = 1;

    @Column(nullable = false)
    private int growthPoints = 0;

    /** Moonlight sleep. No wilting, no guilt, nothing said to the patient. */
    @Column(nullable = false)
    private boolean restingPhase = false;

    @Column(nullable = false)
    private int bloomCount = 0;

    private Instant lastActivity = Instant.now();

    /** Set when the 3-missed-days alert has gone out, so it goes out once. */
    private Instant lastCaregiverAlert;
}
