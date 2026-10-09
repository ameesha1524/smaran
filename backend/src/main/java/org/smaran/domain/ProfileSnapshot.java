package org.smaran.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

/**
 * The profile as it stood after one session, so a time series is a read and
 * not a recomputation. Each map is keyed by target ({@code LANGUAGE},
 * {@code WORKING_MEMORY_SPAN} ...).
 *
 * For a target the session did not touch, velocity and status are carried from
 * the previous snapshot: a rest day is not a decline.
 */
@Entity
@Table(name = "profile_snapshot")
@Getter
@Setter
@NoArgsConstructor
public class ProfileSnapshot {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "patient_id", nullable = false)
    private String patientId;

    @Column(name = "session_id", nullable = false)
    private String sessionId;

    @Column(nullable = false)
    private Instant at;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(columnDefinition = "jsonb", nullable = false)
    private String levels;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(columnDefinition = "jsonb", nullable = false)
    private String velocities;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(columnDefinition = "jsonb", nullable = false)
    private String statuses;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(columnDefinition = "jsonb", nullable = false)
    private String confidences;

    /** Cumulative: a marker this session did not measure keeps its last value. */
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(columnDefinition = "jsonb")
    private String markers;

    @Column(name = "engine_version", nullable = false, length = 20)
    private String engineVersion;
}
