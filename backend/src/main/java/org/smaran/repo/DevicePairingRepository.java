package org.smaran.repo;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import org.smaran.domain.DevicePairing;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.transaction.annotation.Transactional;

public interface DevicePairingRepository extends JpaRepository<DevicePairing, String> {

    Optional<DevicePairing> findByCodeHash(String codeHash);

    boolean existsByCodeHash(String codeHash);

    Optional<DevicePairing> findByIdAndPatientId(String id, String patientId);

    List<DevicePairing> findByPatientIdAndRedeemedAtIsNotNullAndRevokedAtIsNullOrderByRedeemedAtDesc(String patientId);

    /** Only one live code per patient: a new one retires any the family did not use. */
    @Modifying
    @Query("update DevicePairing p set p.revokedAt = :now "
            + "where p.patientId = :patientId and p.redeemedAt is null and p.revokedAt is null")
    int retireUnusedCodes(@Param("patientId") String patientId, @Param("now") Instant now);

    /**
     * Redeem a code, atomically. The WHERE clause is the whole single-use
     * guarantee: two tablets racing the same code cannot both see 1 here.
     */
    @Modifying
    @Query("update DevicePairing p set p.redeemedAt = :now, p.deviceLabel = :label, "
            + "p.tokenExpiresAt = :tokenExpiresAt, p.lastSeenAt = :now "
            + "where p.id = :id and p.redeemedAt is null and p.revokedAt is null and p.expiresAt > :now")
    int claim(
            @Param("id") String id,
            @Param("now") Instant now,
            @Param("label") String label,
            @Param("tokenExpiresAt") Instant tokenExpiresAt);

    /** Called from the auth filter, outside any service transaction. */
    @Transactional
    @Modifying
    @Query("update DevicePairing p set p.lastSeenAt = :now where p.id = :id")
    int touch(@Param("id") String id, @Param("now") Instant now);
}
