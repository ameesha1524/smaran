package org.smaran.repo;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import org.smaran.domain.Alert;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface AlertRepository extends JpaRepository<Alert, String> {

    Optional<Alert> findByPatientIdAndKindAndTargetAndResolvedAtIsNull(String patientId, String kind, String target);

    List<Alert> findByPatientIdOrderByOpenedAtDesc(String patientId);

    List<Alert> findByPatientIdAndResolvedAtIsNullOrderByOpenedAtDesc(String patientId);

    Optional<Alert> findByIdAndPatientId(String id, String patientId);

    /** Patients whose latest session is older than the cutoff: candidates for MISSED_DAYS. */
    @Query("select s.patientId from GameSession s group by s.patientId having max(s.startedAt) < :cutoff")
    List<String> patientsQuietSince(@Param("cutoff") Instant cutoff);
}
