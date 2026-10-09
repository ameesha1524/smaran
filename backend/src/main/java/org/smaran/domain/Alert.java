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
 * Something worth a family member's attention, phrased as an observation with
 * its evidence and never as a conclusion.
 *
 * One open alert per patient, kind and target (a unique index in V2): a
 * continuing episode updates its row instead of raising a duplicate, and
 * {@code resolvedAt} ends the episode. Acknowledging hides nothing from the
 * record; it says someone has seen it.
 */
@Entity
@Table(name = "alert")
@Getter
@Setter
@NoArgsConstructor
public class Alert {

    public static final String MISSED_DAYS = "MISSED_DAYS";
    public static final String DOMAIN_DECLINE = "DOMAIN_DECLINE";
    public static final String SUNDOWNING = "SUNDOWNING";

    @Id
    @Column(length = 36)
    private String id = UUID.randomUUID().toString();

    @Column(name = "patient_id", nullable = false)
    private String patientId;

    @Column(nullable = false, length = 40)
    private String kind;

    /** The domain or sub-signal for DOMAIN_DECLINE; empty for alerts without one. */
    @Column(nullable = false, length = 40)
    private String target = "";

    /** {@code watch}, {@code decline} or {@code info}. */
    @Column(nullable = false, length = 20)
    private String severity;

    @Column(nullable = false, columnDefinition = "text")
    private String message;

    @Column(name = "opened_at", nullable = false)
    private Instant openedAt;

    @Column(name = "last_seen_at", nullable = false)
    private Instant lastSeenAt;

    @Column(name = "resolved_at")
    private Instant resolvedAt;

    @Column(name = "acknowledged_at")
    private Instant acknowledgedAt;

    @Column(name = "acknowledged_by", length = 36)
    private String acknowledgedBy;
}
