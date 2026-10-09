package org.smaran.repo;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import org.smaran.domain.Device;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.transaction.annotation.Transactional;

public interface DeviceRepository extends JpaRepository<Device, String> {

    Optional<Device> findByTokenHash(String tokenHash);

    Optional<Device> findByIdAndPatientId(String id, String patientId);

    List<Device> findByPatientIdAndRevokedAtIsNullAndExpiresAtAfterOrderByPairedAtDesc(String patientId, Instant now);

    /**
     * Note that the tablet was seen, and slide its expiry forward. Only when the
     * last note is older than {@code before}, so a tablet making a request every
     * few seconds costs one write in ten minutes. Called from the auth filter,
     * outside any service transaction.
     */
    @Transactional
    @Modifying
    @Query("update Device d set d.lastSeenAt = :now, d.expiresAt = :expiresAt "
            + "where d.id = :id and (d.lastSeenAt is null or d.lastSeenAt < :before)")
    int touch(
            @Param("id") String id,
            @Param("now") Instant now,
            @Param("before") Instant before,
            @Param("expiresAt") Instant expiresAt);

    /** Ends the tablet's access. Returns 0 if it was already ended or is not hers. */
    @Modifying
    @Query("update Device d set d.revokedAt = :now "
            + "where d.id = :id and d.patientId = :patientId and d.revokedAt is null")
    int revoke(@Param("id") String id, @Param("patientId") String patientId, @Param("now") Instant now);
}
