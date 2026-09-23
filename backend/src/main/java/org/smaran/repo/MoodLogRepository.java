package org.smaran.repo;

import java.time.Instant;
import java.util.List;
import org.smaran.domain.MoodLog;
import org.springframework.data.jpa.repository.JpaRepository;

public interface MoodLogRepository extends JpaRepository<MoodLog, String> {

    List<MoodLog> findByPatientIdAndAtAfterOrderByAtAsc(String patientId, Instant after);
}
