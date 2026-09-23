package org.smaran.repo;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import org.smaran.domain.AcousticVector;
import org.springframework.data.jpa.repository.JpaRepository;

public interface AcousticVectorRepository extends JpaRepository<AcousticVector, String> {

    List<AcousticVector> findByPatientIdAndCapturedAtAfterOrderByCapturedAtAsc(String patientId, Instant after);

    Optional<AcousticVector> findByPatientIdAndCapturedAt(String patientId, Instant capturedAt);
}
