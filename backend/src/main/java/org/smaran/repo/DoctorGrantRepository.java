package org.smaran.repo;

import java.time.Instant;
import java.util.List;
import org.smaran.domain.DoctorGrant;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface DoctorGrantRepository extends JpaRepository<DoctorGrant, String> {

    @Query("select count(g) > 0 from DoctorGrant g where g.patientId = :patientId "
            + "and g.doctorUserId = :doctorId and g.revokedAt is null and g.expiresAt > :now")
    boolean existsLive(@Param("patientId") String patientId, @Param("doctorId") String doctorId, @Param("now") Instant now);

    @Query("select g from DoctorGrant g where g.doctorUserId = :doctorId and g.revokedAt is null "
            + "and g.expiresAt > :now order by g.expiresAt")
    List<DoctorGrant> findLiveForDoctor(@Param("doctorId") String doctorId, @Param("now") Instant now);

    List<DoctorGrant> findByPatientIdOrderByGrantedAtDesc(String patientId);

    /** Ends every unrevoked grant for this pair, expired or not, so a fresh one can be issued. */
    @Modifying(clearAutomatically = true, flushAutomatically = true)
    @Query("update DoctorGrant g set g.revokedAt = :now where g.patientId = :patientId "
            + "and g.doctorUserId = :doctorId and g.revokedAt is null")
    int revokeOpen(@Param("patientId") String patientId, @Param("doctorId") String doctorId, @Param("now") Instant now);
}
