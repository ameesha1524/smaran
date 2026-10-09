package org.smaran.repo;

import java.time.Instant;
import org.smaran.domain.PairingAttempt;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface PairingAttemptRepository extends JpaRepository<PairingAttempt, Long> {

    long countByIpAndSucceededFalseAndAtAfter(String ip, Instant since);

    long countByFingerprintAndSucceededFalseAndAtAfter(String fingerprint, Instant since);

    @Modifying
    @Query("delete from PairingAttempt a where a.at < :before")
    int deleteOlderThan(@Param("before") Instant before);
}
