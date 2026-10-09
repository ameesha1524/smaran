package org.smaran.repo;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import org.smaran.domain.ProfileSnapshot;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface ProfileSnapshotRepository extends JpaRepository<ProfileSnapshot, Long> {

    List<ProfileSnapshot> findByPatientIdAndAtAfterOrderByAtAsc(String patientId, Instant after);

    Optional<ProfileSnapshot> findTopByPatientIdOrderByAtDesc(String patientId);

    List<ProfileSnapshot> findTop14ByPatientIdOrderByAtDesc(String patientId);

    /** A late session invalidates every later snapshot, so they are all rewritten. */
    @Modifying
    @Query("delete from ProfileSnapshot s where s.patientId = :patientId")
    int deleteAllFor(@Param("patientId") String patientId);

    long countByPatientId(String patientId);
}
