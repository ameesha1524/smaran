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
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;
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

    /**
     * The domain readings the profile was updated from, as JSON:
     * {@code {"motor":{"score":0.72,"confidence":1.0}}}. Always the resolved
     * set (see CognitiveMap#readingsFor), so the dashboard trend and the
     * weakest-domain rule read exactly what the profile update read. Null only
     * on rows stored before readings existed; those fall back to completion
     * rate against the game's primary domain.
     */
    @Column(columnDefinition = "text")
    private String domainReadings;

    /**
     * Game-specific raw measures — span history, reaction times, the pond's
     * behavioural breakdown — as opaque JSON for the caregiver view. Never
     * read by the profile update.
     */
    @Column(columnDefinition = "text")
    private String metrics;

    private Instant receivedAt = Instant.now();

    /* ------------------------------------------------ the session envelope */
    // All nullable: rows stored before the envelope existed stay valid, and
    // fall back to `domainReadings` and `completionRate`.

    /** Generated on the tablet. The second dedupe key, beside (patientId, startedAt). */
    @Column(name = "client_session_id", length = 36)
    private String clientSessionId;

    /** The registry id, like duck-roll-call. `gameType` is its enum twin. */
    @Column(name = "game_id", length = 60)
    private String gameId;

    @Column(name = "device_id", length = 36)
    private String deviceId;

    private Boolean completed;

    private Boolean abandoned;

    @Column(name = "hour_of_day")
    private Integer hourOfDay;

    /** Game-specific raw trials. Stored, never shown to anyone, never read by the engine. */
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(columnDefinition = "jsonb")
    private String trials;

    /** What the session said about each target: a list of target, raw, confidence, because. */
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(columnDefinition = "jsonb")
    private String contributions;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(columnDefinition = "jsonb")
    private String markers;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(columnDefinition = "jsonb")
    private String difficulty;

    @Column(name = "precomputed_reading")
    private Boolean precomputedReading;

    @Column(name = "engine_version", length = 20)
    private String engineVersion;

    /** `device` until the server has re-scored the raw trials itself. See V5. */
    @Column(name = "scoring_trust", nullable = false, length = 20)
    private String scoringTrust = "device";
}
