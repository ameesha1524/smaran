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
 * The guardian's consent, recorded when a patient is created and before any
 * data about her is collected: which version of the notice, by whom, when.
 */
@Entity
@Table(name = "consent_record")
@Getter
@Setter
@NoArgsConstructor
public class ConsentRecord {

    @Id
    private String id = UUID.randomUUID().toString();

    @Column(nullable = false)
    private String patientId;

    @Column(nullable = false)
    private String givenBy;

    @Column(nullable = false)
    private String noticeVersion;

    private String guardianName;

    @Column(nullable = false)
    private Instant givenAt = Instant.now();
}
