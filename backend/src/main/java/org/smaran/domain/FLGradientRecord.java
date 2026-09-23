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
 * Proof that a device took part in a federated round — and nothing else.
 *
 * Note what this table does not contain: the gradient. Only its hash is kept,
 * as a receipt. The gradient itself is decrypted in memory, averaged into the
 * global model, and dropped. There is deliberately no column you could query to
 * reconstruct anything about a single patient's behaviour.
 */
@Entity
@Table(name = "fl_gradient_record")
@Getter
@Setter
@NoArgsConstructor
public class FLGradientRecord {

    @Id
    private String id = UUID.randomUUID().toString();

    @Column(nullable = false)
    private String deviceId;

    /** Kept only to rate-limit a device; never joined against session data. */
    private String patientId;

    @Column(nullable = false)
    private Instant receivedAt = Instant.now();

    @Column(nullable = false)
    private String modelVersion;

    /** SHA-256 of the ciphertext. A receipt, not the payload. */
    @Column(nullable = false)
    private String gradientHash;

    @Column(nullable = false)
    private int sampleCount;
}
