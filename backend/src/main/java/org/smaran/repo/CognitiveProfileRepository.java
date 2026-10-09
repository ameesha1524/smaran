package org.smaran.repo;

import jakarta.persistence.LockModeType;
import java.util.Optional;
import org.smaran.domain.CognitiveProfile;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface CognitiveProfileRepository extends JpaRepository<CognitiveProfile, String> {

    /**
     * The profile row, locked for the rest of the transaction. Two batches for
     * one patient must not fold their sessions into the same profile at once.
     */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select p from CognitiveProfile p where p.patientId = :patientId")
    Optional<CognitiveProfile> lockFor(@Param("patientId") String patientId);
}
