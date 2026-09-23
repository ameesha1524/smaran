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
import org.smaran.domain.Enums.PeakWindow;

/**
 * The person the whole system exists for.
 *
 * `kinshipTerm` is the single most important column in this schema. It is what
 * her family actually calls her — Aaita, Ima, Pui — and it is set by a human
 * during setup. The app never infers it from a language code, because guessing
 * wrong is worse than not knowing.
 */
@Entity
@Table(name = "patient")
@Getter
@Setter
@NoArgsConstructor
public class Patient {

    @Id
    private String id = UUID.randomUUID().toString();

    @Column(nullable = false)
    private String name;

    /** BCP-47-ish, or `custom:<slug>` for a language the caregiver added. */
    @Column(nullable = false)
    private String languageCode = "en";

    @Column(nullable = false)
    private String kinshipTerm = "";

    private String region;

    /** Chooses the instrument under the soundscape. Nothing else. */
    private String faith;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    private PeakWindow peakWindow = PeakWindow.MORNING;

    @Column(nullable = false)
    private String profileVersion = "1.0";

    /** Which caregiver may see her. Enforced in every controller, not just here. */
    private String caregiverId;

    private Instant createdAt = Instant.now();
}
