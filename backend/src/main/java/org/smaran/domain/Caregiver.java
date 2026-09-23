package org.smaran.domain;

import jakarta.persistence.CollectionTable;
import jakarta.persistence.Column;
import jakarta.persistence.ElementCollection;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.FetchType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.Table;
import java.util.LinkedHashSet;
import java.util.Set;
import java.util.UUID;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import org.smaran.domain.Enums.Role;

/**
 * A caregiver or a doctor. Both are people who see data about someone else,
 * which is why `assignedPatientIds` is the security boundary of this system:
 * a caregiver sees their own patients and no one else's, and a doctor sees
 * trend summaries and ZKP-verified statements rather than records.
 */
@Entity
@Table(name = "caregiver")
@Getter
@Setter
@NoArgsConstructor
public class Caregiver {

    @Id
    private String id = UUID.randomUUID().toString();

    @Column(nullable = false)
    private String name;

    @Column(nullable = false, unique = true)
    private String email;

    /** BCrypt. Never logged, never returned by any endpoint. */
    @Column(nullable = false)
    private String passwordHash;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    private Role role = Role.CAREGIVER;

    @ElementCollection(fetch = FetchType.EAGER)
    @CollectionTable(name = "caregiver_patient", joinColumns = @JoinColumn(name = "caregiver_id"))
    @Column(name = "patient_id")
    private Set<String> assignedPatientIds = new LinkedHashSet<>();

    /** Where the 3-missed-days SMS goes. */
    private String phone;
}
