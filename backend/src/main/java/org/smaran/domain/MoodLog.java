package org.smaran.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.Index;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import org.smaran.domain.Enums.Mood;

/**
 * One tap on a face, with a timestamp.
 *
 * The timestamp is the point. A mood is a mood; a mood that is consistently low
 * between three and seven in the evening is a sundowning pattern, and that is
 * what silences game reminders after four o'clock.
 */
@Entity
@Table(name = "mood_log", indexes = @Index(name = "idx_mood_patient_time", columnList = "patient_id, at"))
@Getter
@Setter
@NoArgsConstructor
public class MoodLog {

    @Id
    private String id = UUID.randomUUID().toString();

    @Column(name = "patient_id", nullable = false)
    private String patientId;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    private Mood mood;

    @Column(name = "at", nullable = false)
    private Instant at = Instant.now();

    /** Local hour on her device, so sundowning survives a server in another zone. */
    @Column(nullable = false)
    private int localHour;
}
