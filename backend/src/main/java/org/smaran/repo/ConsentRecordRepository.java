package org.smaran.repo;

import org.smaran.domain.ConsentRecord;
import org.springframework.data.jpa.repository.JpaRepository;

public interface ConsentRecordRepository extends JpaRepository<ConsentRecord, String> {

    boolean existsByPatientId(String patientId);
}
