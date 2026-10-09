package org.smaran.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import org.smaran.domain.Enums.Role;

/**
 * A person who signs in: an admin, a caregiver or a doctor.
 *
 * The patient is not a user. She never has an account or a password; her
 * tablet holds a device token instead (see DevicePairing).
 *
 * Which patients a user may see is not stored here. A caregiver owns the
 * patients whose {@code caregiver_id} is theirs, and a doctor sees the patients
 * with a live {@link DoctorGrant}. Both are looked up on every request by
 * AccessGuard, so removing access takes effect at once and no token can carry
 * a stale list.
 */
@Entity
@Table(name = "app_user")
@Getter
@Setter
@NoArgsConstructor
public class AppUser {

    public enum Status {
        ACTIVE,
        /** A doctor who has registered and not yet been approved. Can use nothing. */
        PENDING,
        DISABLED
    }

    @Id
    private String id = UUID.randomUUID().toString();

    /** Stored lower-case; the database enforces it. */
    @Column(nullable = false, unique = true)
    private String email;

    /** BCrypt. Never logged, never returned by any endpoint. */
    @Column(nullable = false)
    private String passwordHash;

    @Column(nullable = false)
    private String name;

    private String phone;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    private Role role = Role.CAREGIVER;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    private Status status = Status.ACTIVE;

    @Column(nullable = false)
    private int failedLogins;

    private Instant lockedUntil;

    @Column(nullable = false)
    private Instant createdAt = Instant.now();

    private Instant lastLoginAt;

    public void setEmail(String email) {
        this.email = email == null ? null : email.trim().toLowerCase();
    }
}
