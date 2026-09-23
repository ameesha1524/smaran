package org.smaran.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.util.UUID;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import org.smaran.domain.Enums.SemanticCluster;

/**
 * An object from her life, uploaded by the caregiver.
 *
 * Deliberately not a library of "NER cultural symbols": a prescribed dhol means
 * nothing if her house never had one, and her own brass lamp means everything.
 * The glyph is a placeholder that exists only until a photograph replaces it.
 */
@Entity
@Table(name = "meaningful_object")
@Getter
@Setter
@NoArgsConstructor
public class MeaningfulObject {

    @Id
    private String id = UUID.randomUUID().toString();

    @Column(name = "patient_id", nullable = false)
    private String patientId;

    @Column(nullable = false)
    private String name;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    private SemanticCluster semanticCluster = SemanticCluster.DAILY_LIFE;

    private String imageS3Key;

    private String glyph;
}
