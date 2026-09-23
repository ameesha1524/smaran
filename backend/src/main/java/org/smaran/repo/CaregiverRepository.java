package org.smaran.repo;

import java.util.Optional;
import org.smaran.domain.Caregiver;
import org.springframework.data.jpa.repository.JpaRepository;

public interface CaregiverRepository extends JpaRepository<Caregiver, String> {

    Optional<Caregiver> findByEmailIgnoreCase(String email);
}
