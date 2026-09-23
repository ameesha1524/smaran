package org.smaran.repo;

import java.util.List;
import org.smaran.domain.Patient;
import org.springframework.data.jpa.repository.JpaRepository;

public interface PatientRepository extends JpaRepository<Patient, String> {

    List<Patient> findByCaregiverId(String caregiverId);
}
