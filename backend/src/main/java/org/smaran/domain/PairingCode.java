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
 * A one-time code the family mints on their own phone and types into a tablet.
 *
 * Only a peppered SHA-256 of the code is stored, so a copy of the database does
 * not hand out live codes. It works once: {@code redeemedAt} is set by a
 * conditional UPDATE, which is the whole single-use guarantee.
 */
@Entity
@Table(name = "pairing_code")
@Getter
@Setter
@NoArgsConstructor
public class PairingCode {

    @Id
    private String id = UUID.randomUUID().toString();

    @Column(name = "patient_id", nullable = false)
    private String patientId;

    @Column(name = "code_hash", nullable = false, unique = true, length = 64)
    private String codeHash;

    /** The family account that minted it. Null only in the dev-only open demo, which has no accounts. */
    @Column(name = "created_by", length = 36)
    private String createdBy;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt;

    @Column(name = "expires_at", nullable = false)
    private Instant expiresAt;

    @Column(name = "redeemed_at")
    private Instant redeemedAt;

    @Column(name = "redeemed_device_id", length = 36)
    private String redeemedDeviceId;

    /** Set on an unused code replaced by a newer one. */
    @Column(name = "revoked_at")
    private Instant revokedAt;
}
