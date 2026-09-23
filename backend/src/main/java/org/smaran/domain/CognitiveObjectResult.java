package org.smaran.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.Index;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import org.smaran.domain.Enums.SemanticCluster;

/**
 * One object, touched or not touched, and how long it took.
 *
 * Rows are aggregated per semantic cluster over 30 days. A cluster falling
 * while its neighbours hold is a declining memory *domain*; all clusters falling
 * together is something else entirely. That distinction is the reason this table
 * stores the cluster alongside the object rather than just the object.
 */
@Entity
@Table(
        name = "cognitive_object_result",
        indexes = @Index(name = "idx_object_patient_time", columnList = "patient_id, captured_at"))
@Getter
@Setter
@NoArgsConstructor
public class CognitiveObjectResult {

    @Id
    private String id = UUID.randomUUID().toString();

    private String sessionId;

    @Column(name = "patient_id", nullable = false)
    private String patientId;

    @Column(nullable = false)
    private String objectName;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    private SemanticCluster semanticCluster;

    /** Reaction latency in ms; 0 when she did not touch it at all. */
    @Column(nullable = false)
    private long tappedMs;

    @Column(nullable = false)
    private boolean wasCorrect;

    @Column(name = "captured_at", nullable = false)
    private Instant capturedAt = Instant.now();
}
