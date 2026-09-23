package org.smaran.repo;

import java.time.Instant;
import org.smaran.domain.FLGradientRecord;
import org.springframework.data.jpa.repository.JpaRepository;

public interface FLGradientRecordRepository extends JpaRepository<FLGradientRecord, String> {

    /** Rate-limiting: one round per device per window, so no device dominates. */
    long countByDeviceIdAndReceivedAtAfter(String deviceId, Instant after);
}
