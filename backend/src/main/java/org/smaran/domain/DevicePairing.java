package org.smaran.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Index;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

/**
 * One pairing code, and — once redeemed — the tablet that redeemed it.
 *
 * The row is born as a code: a hash, an owner, a ten-minute expiry. Redeeming
 * it turns the same row into the record of a device: its label, when it was
 * paired, when its token expires, when it was last seen. Revoking it ends the
 * device's access on its very next request. One row per tablet, for its whole
 * life, is what lets the family's "paired tablets" list and the audit of
 * "who could see Ma's data" be the same query.
 *
 * The code itself is never stored — only its SHA-256. It is shown to the family
 * once, in the response that created it.
 *
 * Shape follows `device_pairings` in docs/rbac-architecture.md, plus the three
 * device-lifecycle columns that design implies but does not spell out
 * (token_expires_at, last_seen_at, revoked_at).
 */
@Entity
@Table(
        name = "device_pairing",
        indexes = @Index(name = "idx_pairing_patient", columnList = "patient_id"))
@Getter
@Setter
@NoArgsConstructor
public class DevicePairing {

    @Id
    private String id = UUID.randomUUID().toString();

    @Column(name = "patient_id", nullable = false)
    private String patientId;

    /** SHA-256 of the normalised code, lowercase hex. */
    @Column(name = "code_hash", nullable = false, unique = true, length = 64)
    private String codeHash;

    /** The family account that generated the code. */
    @Column(name = "created_by")
    private String createdBy;

    @Column(nullable = false)
    private Instant createdAt = Instant.now();

    /** When the *code* stops working. The device token has its own expiry. */
    @Column(nullable = false)
    private Instant expiresAt;

    private Instant redeemedAt;

    @Column(length = 120)
    private String deviceLabel;

    private Instant tokenExpiresAt;

    private Instant lastSeenAt;

    /** Set on an unused code superseded by a newer one, or on a tablet the family removed. */
    private Instant revokedAt;

    public boolean isActiveDevice(Instant now) {
        return redeemedAt != null && revokedAt == null && tokenExpiresAt != null && tokenExpiresAt.isAfter(now);
    }
}
