package org.smaran.repo;

import java.util.List;
import org.smaran.domain.MeaningfulObject;
import org.springframework.data.jpa.repository.JpaRepository;

public interface MeaningfulObjectRepository extends JpaRepository<MeaningfulObject, String> {

    List<MeaningfulObject> findByPatientId(String patientId);

    void deleteByPatientId(String patientId);
}
