package org.smaran.repo;

import java.time.Instant;
import java.util.Optional;
import org.smaran.domain.PairingCode;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface PairingCodeRepository extends JpaRepository<PairingCode, String> {

    Optional<PairingCode> findByCodeHash(String codeHash);

    boolean existsByCodeHash(String codeHash);

    /** One live code per patient: minting a new one retires any the family did not use. */
    @Modifying
    @Query("update PairingCode c set c.revokedAt = :now "
            + "where c.patientId = :patientId and c.redeemedAt is null and c.revokedAt is null")
    int retireUnused(@Param("patientId") String patientId, @Param("now") Instant now);

    /**
     * Redeem a code, atomically. The WHERE clause is the whole single-use
     * guarantee: two tablets racing one code cannot both see 1 here.
     */
    @Modifying
    @Query("update PairingCode c set c.redeemedAt = :now "
            + "where c.id = :id and c.redeemedAt is null and c.revokedAt is null and c.expiresAt > :now")
    int claim(@Param("id") String id, @Param("now") Instant now);

    /** Records which tablet a redeemed code produced. */
    @Modifying
    @Query("update PairingCode c set c.redeemedDeviceId = :deviceId where c.id = :id")
    int attachDevice(@Param("id") String id, @Param("deviceId") String deviceId);
}
