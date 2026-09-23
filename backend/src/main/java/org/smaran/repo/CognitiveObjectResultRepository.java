package org.smaran.repo;

import java.time.Instant;
import java.util.List;
import org.smaran.domain.CognitiveObjectResult;
import org.springframework.data.jpa.repository.JpaRepository;

public interface CognitiveObjectResultRepository extends JpaRepository<CognitiveObjectResult, String> {

    List<CognitiveObjectResult> findByPatientIdAndCapturedAtAfter(String patientId, Instant after);
}
