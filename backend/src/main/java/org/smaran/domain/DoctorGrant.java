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
 * A caregiver lets a doctor see one patient, until a date, and can end it
 * sooner. The grant is live while it is not revoked and has not expired; that
 * is evaluated on every request, so an expired grant stops working at once.
 */
@Entity
@Table(name = "doctor_grant")
@Getter
@Setter
@NoArgsConstructor
public class DoctorGrant {

    @Id
    private String id = UUID.randomUUID().toString();

    @Column(nullable = false)
    private String patientId;

    @Column(name = "doctor_user_id", nullable = false)
    private String doctorUserId;

    @Column(nullable = false)
    private String grantedBy;

    @Column(nullable = false)
    private Instant grantedAt = Instant.now();

    @Column(nullable = false)
    private Instant expiresAt;

    private Instant revokedAt;

    public boolean isLiveAt(Instant now) {
        return revokedAt == null && expiresAt.isAfter(now);
    }
}
