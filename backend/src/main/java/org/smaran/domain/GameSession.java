package org.smaran.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.Index;
import jakarta.persistence.Table;
import jakarta.persistence.UniqueConstraint;
import java.time.Instant;
import java.util.UUID;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import org.smaran.domain.Enums.GameType;
import org.smaran.domain.Enums.Mood;

/**
 * One finished session.
 *
 * The unique constraint on (patientId, startedAt) is what makes offline sync
 * idempotent: a tablet that queues a session, loses power, and re-sends the
 * whole queue on reconnect cannot double-water the garden.
 *
 * Note what is *not* here: no score, no pass/fail, no streak. `completionRate`
 * is how much of the session she did, and every session ends in success.
 */
@Entity
@Table(
        name = "game_session",
        uniqueConstraints = @UniqueConstraint(columnNames = {"patient_id", "started_at"}),
        indexes = @Index(name = "idx_session_patient_time", columnList = "patient_id, started_at"))
@Getter
@Setter
@NoArgsConstructor
public class GameSession {

    @Id
    private String id = UUID.randomUUID().toString();

    @Column(name = "patient_id", nullable = false)
    private String patientId;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    private GameType gameType;

    @Column(name = "started_at", nullable = false)
    private Instant startedAt;

    @Column(nullable = false)
    private long durationMs;

    /** 0–1. How much of the session she completed, not how well she scored. */
    @Column(nullable = false)
    private double completionRate;

    @Column(nullable = false)
    private int difficultyTier;

    /** Peak composite load observed during the session, 0–1. */
    @Column(nullable = false)
    private double cognitiveLoadScore;

    @Enumerated(EnumType.STRING)
    private Mood moodAtStart;

    /** True when the adaptive layer eased this session mid-flight. */
    @Column(nullable = false)
    private boolean easedMidSession = false;

    private Instant receivedAt = Instant.now();
}
