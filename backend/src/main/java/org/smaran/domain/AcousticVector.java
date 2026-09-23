package org.smaran.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Index;
import jakarta.persistence.Table;
import jakarta.persistence.UniqueConstraint;
import java.time.Instant;
import java.util.UUID;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

/**
 * Five numbers extracted from her voice on her own device.
 *
 * There is no audio column in this table and there never will be one. The
 * waveform is analysed in the browser and discarded; only these scalars are
 * transmitted. That is the whole voice-biomarker privacy claim, and it is
 * enforced by the schema rather than by a policy document.
 *
 *   jitter            cycle-to-cycle pitch perturbation  → tremor, motor fatigue
 *   shimmer           amplitude perturbation             → vocal fatigue
 *   pauseDurationAvg  mean silence between phonations    → word-finding difficulty
 *   speechRate        voiced runs per second             → processing speed
 *   phonationRatio    voiced time over total time        → sustained phonation
 */
@Entity
@Table(
        name = "acoustic_vector",
        uniqueConstraints = @UniqueConstraint(columnNames = {"patient_id", "captured_at"}),
        indexes = @Index(name = "idx_acoustic_patient_time", columnList = "patient_id, captured_at"))
@Getter
@Setter
@NoArgsConstructor
public class AcousticVector {

    @Id
    private String id = UUID.randomUUID().toString();

    @Column(name = "patient_id", nullable = false)
    private String patientId;

    private String sessionId;

    @Column(name = "captured_at", nullable = false)
    private Instant capturedAt;

    @Column(nullable = false)
    private double jitter;

    @Column(nullable = false)
    private double shimmer;

    @Column(nullable = false)
    private double pauseDurationAvg;

    @Column(nullable = false)
    private double speechRate;

    @Column(nullable = false)
    private double phonationRatio;
}
