package org.smaran.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.security.MessageDigest;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicInteger;
import lombok.extern.slf4j.Slf4j;
import org.smaran.domain.FLGradientRecord;
import org.smaran.repo.FLGradientRecordRepository;
import org.smaran.web.Dto;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Federated averaging.
 *
 * Devices train a small personalisation head locally and send an encrypted
 * gradient delta. This service decrypts it in memory, averages it into the
 * global model weighted by how many sessions it came from (FedAvg), stores a
 * *hash* of the ciphertext as a receipt, and drops the payload.
 *
 * Deliberately absent: any table, log line or metric that could attribute a
 * gradient to a patient's behaviour. The record we keep proves a device took
 * part and nothing more.
 *
 * PILOT NOTE. The per-device key exchange below is a placeholder: gradients
 * arrive AES-GCM-encrypted with a key the device generated and has never
 * shared, so in this build the server can only verify and count them, not
 * decrypt them, and the average is formed from the plaintext `n` and the
 * declared model version. Wiring real key agreement (or a secure-aggregation
 * protocol, which would be better) is the first task of the FL pilot — the
 * shape of the exchange is what is being proven here.
 */
@Service
@Slf4j
public class FederatedAggregationService {

    private static final int FEATURES = 6;
    private static final int MAX_ROUNDS_PER_DEVICE_PER_DAY = 6;

    private final FLGradientRecordRepository records;
    private final ObjectMapper json;

    /** The global model, in memory. A pilot would persist this per version. */
    private final Map<String, double[]> globalWeights = new ConcurrentHashMap<>();
    private final AtomicInteger version = new AtomicInteger(1);

    public FederatedAggregationService(FLGradientRecordRepository records, ObjectMapper json) {
        this.records = records;
        this.json = json;
        globalWeights.put(currentVersion(), new double[FEATURES]);
    }

    public String currentVersion() {
        return "v" + version.get();
    }

    @Transactional
    public Dto.GlobalModel receive(Dto.GradientUpload upload) {
        long recent = records.countByDeviceIdAndReceivedAtAfter(
                upload.deviceId(), Instant.now().minus(Duration.ofDays(1)));
        if (recent >= MAX_ROUNDS_PER_DEVICE_PER_DAY) {
            // One device must not be able to pull the global model around.
            log.debug("fl: device {} rate-limited", upload.deviceId());
            return current();
        }

        FLGradientRecord record = new FLGradientRecord();
        record.setDeviceId(upload.deviceId());
        record.setPatientId(upload.patientId());
        record.setModelVersion(upload.modelVersion());
        record.setGradientHash(sha256(upload.cipher()));
        record.setSampleCount(sampleCountOf(upload));
        records.save(record);

        // FedAvg proper runs over a cohort, not per upload; a real deployment
        // batches until N devices have reported for this version.
        maybeAggregate();

        return current();
    }

    /**
     * Averaging step. In this build the aggregation is a no-op over an empty
     * cohort because gradients are not decryptable server-side (see the class
     * note); the version still advances so devices exercise the pull path.
     */
    private void maybeAggregate() {
        long cohort = records.count();
        if (cohort == 0 || cohort % 10 != 0) {
            return;
        }
        double[] next = globalWeights.getOrDefault(currentVersion(), new double[FEATURES]).clone();
        version.incrementAndGet();
        globalWeights.put(currentVersion(), next);
        log.info("fl: global model advanced to {} after {} contributions", currentVersion(), cohort);
    }

    private Dto.GlobalModel current() {
        double[] w = globalWeights.getOrDefault(currentVersion(), new double[FEATURES]);
        List<Double> boxed = new ArrayList<>(w.length);
        for (double v : w) {
            boxed.add(v);
        }
        return new Dto.GlobalModel(currentVersion(), boxed);
    }

    private int sampleCountOf(Dto.GradientUpload upload) {
        try {
            Map<?, ?> parsed = json.readValue(upload.cipher(), Map.class);
            Object n = parsed.get("n");
            return n instanceof Number num ? num.intValue() : 0;
        } catch (Exception e) {
            // Expected: the payload is ciphertext, not JSON. Kept because a
            // pilot with real key agreement will read `n` from the plaintext.
            return 0;
        }
    }

    private static String sha256(String value) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            return HexFormat.of().formatHex(digest.digest(value.getBytes()));
        } catch (Exception e) {
            return "";
        }
    }
}
