package org.smaran.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

/**
 * One try at redeeming a code. Kept so guessing can be limited in the database:
 * the limit then survives a restart and holds across several servers. The
 * address is stored only as a hash, and old rows are deleted.
 */
@Entity
@Table(name = "pairing_attempt")
@Getter
@Setter
@NoArgsConstructor
public class PairingAttempt {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false)
    private Instant at;

    @Column(length = 64)
    private String ip;

    @Column(length = 64)
    private String fingerprint;

    @Column(nullable = false)
    private boolean succeeded;
}
