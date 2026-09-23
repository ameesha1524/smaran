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
import org.smaran.domain.Enums.ReminderType;

/**
 * A reminder.
 *
 * The server schedules and pushes these, but it is never the only path: the
 * same schedule is mirrored into the Service Worker so her tablet can tell her
 * about her eight o'clock tablet with the radio off for three days.
 *
 * `messageTemplate` carries `{kin}` and is rendered in her language with her
 * kinship term, because "Patient, take medication" is not a sentence anyone
 * should hear in their own home.
 */
@Entity
@Table(name = "reminder_schedule")
@Getter
@Setter
@NoArgsConstructor
public class ReminderSchedule {

    @Id
    private String id = UUID.randomUUID().toString();

    @Column(name = "patient_id", nullable = false)
    private String patientId;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    private ReminderType type = ReminderType.MEDICINE;

    /** "HH:mm", local to her. */
    @Column(nullable = false)
    private String scheduledTime;

    /** A photograph of the actual pill, so she recognises it in her hand. */
    private String photoS3Key;

    @Column(columnDefinition = "text", nullable = false)
    private String messageTemplate = "{kin}, it is time for your tablet.";

    @Column(nullable = false)
    private String languageCode = "en";

    @Column(nullable = false)
    private boolean active = true;
}
