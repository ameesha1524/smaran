package org.smaran.service;

import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayDeque;
import java.util.Deque;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import lombok.extern.slf4j.Slf4j;
import org.smaran.config.JwtService;
import org.smaran.domain.DevicePairing;
import org.smaran.repo.DevicePairingRepository;
import org.smaran.repo.PatientRepository;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

/**
 * Pairing her tablet with the family's account.
 *
 * A patient never holds credentials (docs/rbac-architecture.md §2). Instead the
 * family generates a one-time code on their own phone; the tablet redeems it
 * once and receives a long-lived device token carrying the PATIENT role, scoped
 * to her and nobody else.
 *
 * The properties this class exists to guarantee:
 *
 * <ul>
 *   <li><b>The code is never stored.</b> Only an HMAC-SHA-256 of it, keyed with
 *       the server secret, so a database dump does not hand out live codes.</li>
 *   <li><b>Single use, short life.</b> Ten minutes, one redemption, enforced by
 *       a conditional UPDATE so two tablets racing one code cannot both win.
 *       Generating a new code retires any unused one.</li>
 *   <li><b>Guessing is rate-limited.</b> Eight symbols from a 30-letter alphabet
 *       is ~39 bits; ten failed attempts per client per fifteen minutes, on top
 *       of the ten-minute expiry, puts brute force far out of reach. Every
 *       failure — unknown, expired, used, revoked — gets the same answer.</li>
 *   <li><b>Removal is immediate.</b> A revoked device is refused on its next
 *       request. The active-check is cached for {@link #CHECK_TTL} per node,
 *       so on a multi-node deployment removal lands within that window.</li>
 * </ul>
 */
@Service
@Slf4j
public class PairingService {

    /** No I, L, O, U, 0 or 1 — nothing that reads as something else across a room. */
    static final String ALPHABET = "ABCDEFGHJKMNPQRSTVWXYZ23456789";
    static final int CODE_LENGTH = 8;

    static final Duration CHECK_TTL = Duration.ofSeconds(30);
    /** last_seen_at is for "is the tablet alive", not an access log; ten-minute grain is plenty. */
    static final Duration SEEN_GRAIN = Duration.ofMinutes(10);

    private final DevicePairingRepository pairings;
    private final PatientRepository patients;
    private final JwtService jwt;
    private final SecretKeySpec hashKey;
    private final Duration codeTtl;
    private final Duration deviceTtl;
    private final FailureLimiter limiter;
    private final SecureRandom random = new SecureRandom();
    private final Map<String, Check> activeCache = new ConcurrentHashMap<>();
    private Clock clock = Clock.systemUTC();

    public PairingService(
            DevicePairingRepository pairings,
            PatientRepository patients,
            JwtService jwt,
            @Value("${smaran.security.jwt-secret}") String secret,
            @Value("${smaran.pairing.code-ttl-minutes:10}") long codeTtlMinutes,
            @Value("${smaran.pairing.device-ttl-days:180}") long deviceTtlDays,
            @Value("${smaran.pairing.max-failures:10}") int maxFailures,
            @Value("${smaran.pairing.failure-window-minutes:15}") long failureWindowMinutes) {
        this.pairings = pairings;
        this.patients = patients;
        this.jwt = jwt;
        this.hashKey = new SecretKeySpec(secret.getBytes(StandardCharsets.UTF_8), "HmacSHA256");
        this.codeTtl = Duration.ofMinutes(codeTtlMinutes);
        this.deviceTtl = Duration.ofDays(deviceTtlDays);
        this.limiter = new FailureLimiter(maxFailures, Duration.ofMinutes(failureWindowMinutes));
    }

    /** Tests only. */
    void useClock(Clock clock) {
        this.clock = clock;
    }

    public record IssuedCode(String code, Instant expiresAt) {
    }

    public record Redemption(String deviceToken, String deviceId, String patientId, Instant expiresAt) {
    }

    /* ------------------------------------------------------------- family */

    @Transactional
    public IssuedCode issueCode(String patientId, String createdBy) {
        if (!patients.existsById(patientId)) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND);
        }
        Instant now = clock.instant();
        pairings.retireUnusedCodes(patientId, now);

        String code;
        String hash;
        do {
            code = generateCode();
            hash = hash(code);
        } while (pairings.existsByCodeHash(hash));

        DevicePairing row = new DevicePairing();
        row.setPatientId(patientId);
        row.setCodeHash(hash);
        row.setCreatedBy(createdBy);
        row.setCreatedAt(now);
        row.setExpiresAt(now.plus(codeTtl));
        pairings.save(row);

        log.info("pairing code issued (pairing {}) by {}", row.getId(), createdBy);
        return new IssuedCode(format(code), row.getExpiresAt());
    }

    /** Tablets that currently hold a live device token for her. */
    public List<DevicePairing> devices(String patientId) {
        Instant now = clock.instant();
        return pairings.findByPatientIdAndRedeemedAtIsNotNullAndRevokedAtIsNullOrderByRedeemedAtDesc(patientId)
                .stream()
                .filter(p -> p.isActiveDevice(now))
                .toList();
    }

    @Transactional
    public void revoke(String patientId, String deviceId) {
        DevicePairing device = pairings.findByIdAndPatientId(deviceId, patientId)
                .filter(p -> p.getRedeemedAt() != null)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND));
        if (device.getRevokedAt() == null) {
            device.setRevokedAt(clock.instant());
            pairings.save(device);
            log.info("device {} removed", deviceId);
        }
        activeCache.remove(deviceId);
    }

    /* ------------------------------------------------------------- tablet */

    /**
     * @param clientKey who is asking, for the failure limit — the remote address.
     */
    @Transactional
    public Redemption redeem(String rawCode, String rawLabel, String clientKey) {
        Instant now = clock.instant();
        if (limiter.locked(clientKey, now)) {
            throw new ResponseStatusException(HttpStatus.TOO_MANY_REQUESTS, "Too many attempts.");
        }

        String code = normalise(rawCode);
        DevicePairing row = code == null ? null : pairings.findByCodeHash(hash(code)).orElse(null);
        Instant tokenExpiresAt = now.plus(deviceTtl);

        if (row == null || pairings.claim(row.getId(), now, label(rawLabel), tokenExpiresAt) != 1) {
            limiter.record(clientKey, now);
            // Unknown, expired, already used or superseded: one answer for all
            // of them, so a guess learns nothing about which it was.
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "That code didn't work.");
        }

        String token = jwt.issueDevice(row.getPatientId(), row.getId(), tokenExpiresAt);
        activeCache.remove(row.getId());
        log.info("device {} paired", row.getId());
        return new Redemption(token, row.getId(), row.getPatientId(), tokenExpiresAt);
    }

    /**
     * Is this device token still honoured? Called by the auth filter on every
     * request that carries one, so it is cached briefly and touches
     * last_seen_at at most once per {@link #SEEN_GRAIN}.
     */
    public boolean isDeviceActive(String deviceId) {
        Instant now = clock.instant();
        Check cached = activeCache.get(deviceId);
        if (cached != null && cached.checkedAt().plus(CHECK_TTL).isAfter(now)) {
            return cached.active();
        }
        DevicePairing device = pairings.findById(deviceId).orElse(null);
        boolean active = device != null && device.isActiveDevice(now);
        if (active && (device.getLastSeenAt() == null || device.getLastSeenAt().isBefore(now.minus(SEEN_GRAIN)))) {
            pairings.touch(deviceId, now);
        }
        activeCache.put(deviceId, new Check(active, now));
        return active;
    }

    private record Check(boolean active, Instant checkedAt) {
    }

    /* ------------------------------------------------------------ helpers */

    String generateCode() {
        StringBuilder sb = new StringBuilder(CODE_LENGTH);
        for (int i = 0; i < CODE_LENGTH; i++) {
            sb.append(ALPHABET.charAt(random.nextInt(ALPHABET.length())));
        }
        return sb.toString();
    }

    /**
     * Uppercase, drop spaces and dashes. Returns null for anything that could
     * not have been issued — wrong length, or a symbol outside the alphabet.
     */
    static String normalise(String raw) {
        if (raw == null) {
            return null;
        }
        String s = raw.toUpperCase().replaceAll("[\\s-]", "");
        if (s.length() != CODE_LENGTH) {
            return null;
        }
        for (int i = 0; i < s.length(); i++) {
            if (ALPHABET.indexOf(s.charAt(i)) < 0) {
                return null;
            }
        }
        return s;
    }

    /** {@code ABCD-EFGH}: two groups of four, easier to read aloud and to type. */
    static String format(String code) {
        return code.substring(0, 4) + "-" + code.substring(4);
    }

    String hash(String normalisedCode) {
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(hashKey);
            return HexFormat.of().formatHex(mac.doFinal(normalisedCode.getBytes(StandardCharsets.UTF_8)));
        } catch (Exception e) {
            throw new IllegalStateException("HmacSHA256 unavailable", e);
        }
    }

    /** A label is the family's own words; keep it printable and bounded. */
    static String label(String raw) {
        if (raw == null) {
            return "Tablet";
        }
        String s = raw.replaceAll("\\p{Cntrl}", "").strip();
        if (s.isEmpty()) {
            return "Tablet";
        }
        return s.length() > 120 ? s.substring(0, 120) : s;
    }

    /**
     * Failed redemptions per client in a sliding window. In memory: a restart
     * forgets it, which the ten-minute code expiry makes harmless.
     */
    static final class FailureLimiter {

        private final int max;
        private final Duration window;
        private final Map<String, Deque<Instant>> failures = new ConcurrentHashMap<>();

        FailureLimiter(int max, Duration window) {
            this.max = max;
            this.window = window;
        }

        boolean locked(String key, Instant now) {
            Deque<Instant> q = failures.get(key);
            if (q == null) {
                return false;
            }
            synchronized (q) {
                prune(q, now);
                return q.size() >= max;
            }
        }

        void record(String key, Instant now) {
            Deque<Instant> q = failures.computeIfAbsent(key, k -> new ArrayDeque<>());
            synchronized (q) {
                prune(q, now);
                q.addLast(now);
            }
            // Keep the map from growing without bound under a spray of addresses.
            if (failures.size() > 10_000) {
                failures.entrySet().removeIf(e -> {
                    synchronized (e.getValue()) {
                        prune(e.getValue(), now);
                        return e.getValue().isEmpty();
                    }
                });
            }
        }

        private void prune(Deque<Instant> q, Instant now) {
            Instant cutoff = now.minus(window);
            while (!q.isEmpty() && !q.peekFirst().isAfter(cutoff)) {
                q.pollFirst();
            }
        }
    }
}
