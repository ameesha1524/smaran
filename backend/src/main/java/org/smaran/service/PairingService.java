package org.smaran.service;

import java.security.SecureRandom;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.Base64;
import java.util.Map;
import lombok.extern.slf4j.Slf4j;
import org.smaran.domain.Device;
import org.smaran.domain.PairingAttempt;
import org.smaran.domain.PairingCode;
import org.smaran.repo.DeviceRepository;
import org.smaran.repo.PairingAttemptRepository;
import org.smaran.repo.PairingCodeRepository;
import org.smaran.repo.PatientRepository;
import org.smaran.service.AuditService.Actor;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

/**
 * Pairing her tablet with the family's account.
 *
 * She never holds credentials. The family mints a one-time code on their own
 * phone; the tablet redeems it once and receives a device token that is scoped
 * to her and to nobody else.
 *
 * What this class exists to guarantee:
 *
 * <ul>
 *   <li><b>The code is never stored.</b> Only a SHA-256 of it mixed with a server
 *       pepper, so a copy of the database does not hand out live codes.</li>
 *   <li><b>One use, 72 hours.</b> Redemption is a conditional UPDATE, so two
 *       tablets racing one code cannot both win. Minting a new code retires any
 *       unused one.</li>
 *   <li><b>Guessing is limited, in the database.</b> Six symbols from 27 is
 *       about 28.5 bits, which on its own would be guessable. So: 5 failed
 *       tries per tablet fingerprint and 5 per client address per 15 minutes,
 *       and a locked client is refused even when its next try is correct. The
 *       count lives in {@code pairing_attempt}, so it survives a restart and is
 *       shared by every server. Every failure (unknown, expired, used,
 *       replaced, malformed) gets the same answer.</li>
 *   <li><b>The token is opaque and stored hashed.</b> See {@link DeviceService}.</li>
 * </ul>
 *
 * Honest limit: an attacker with many addresses AND many fingerprints is not
 * stopped by per-client limits. One code is worth guessing only for the 72 hours
 * it lives, and it unlocks one patient's tablet view, not the family's account.
 */
@Service
@Slf4j
public class PairingService {

    /** No 0/O, 1/I/L, 5/S or 8/B: nothing that reads as something else across a room. 27 distinct symbols. */
    public static final String ALPHABET = "ACDEFGHJKMNPQRTUVWXYZ234679";
    public static final int CODE_LENGTH = 6;

    private static final int FINGERPRINT_MAX = 64;

    private final PairingCodeRepository codes;
    private final DeviceRepository devices;
    private final PairingAttemptRepository attempts;
    private final PatientRepository patients;
    private final AuditService audit;
    private final Clock clock;
    private final String pepper;
    private final Duration codeTtl;
    private final Duration deviceTtl;
    private final int maxFailures;
    private final Duration window;
    private final SecureRandom random = new SecureRandom();

    public PairingService(
            PairingCodeRepository codes,
            DeviceRepository devices,
            PairingAttemptRepository attempts,
            PatientRepository patients,
            AuditService audit,
            Clock clock,
            @Value("${smaran.pairing.pepper:${smaran.security.jwt-secret}}") String pepper,
            @Value("${smaran.pairing.code-ttl-hours:72}") long codeTtlHours,
            @Value("${smaran.pairing.device-ttl-days:180}") long deviceTtlDays,
            @Value("${smaran.pairing.max-failures:5}") int maxFailures,
            @Value("${smaran.pairing.failure-window-minutes:15}") long failureWindowMinutes) {
        this.codes = codes;
        this.devices = devices;
        this.attempts = attempts;
        this.patients = patients;
        this.audit = audit;
        this.clock = clock;
        this.pepper = pepper;
        this.codeTtl = Duration.ofHours(codeTtlHours);
        this.deviceTtl = Duration.ofDays(deviceTtlDays);
        this.maxFailures = maxFailures;
        this.window = Duration.ofMinutes(failureWindowMinutes);
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
        codes.retireUnused(patientId, now);

        String code;
        String hash;
        do {
            code = generateCode();
            hash = hash(code);
        } while (codes.existsByCodeHash(hash));

        PairingCode row = new PairingCode();
        row.setPatientId(patientId);
        row.setCodeHash(hash);
        row.setCreatedBy(createdBy);
        row.setCreatedAt(now);
        row.setExpiresAt(now.plus(codeTtl));
        codes.save(row);

        log.info("pairing code issued ({}) by {}", row.getId(), createdBy);
        return new IssuedCode(format(code), row.getExpiresAt());
    }

    /* ------------------------------------------------------------- tablet */

    /**
     * @param rawFingerprint the random id the tablet made for itself; optional, but a tablet that
     *                       omits it is limited by address only
     * @param clientAddress  the remote address, for the per-address limit
     */
    @Transactional(noRollbackFor = ResponseStatusException.class)
    public Redemption redeem(String rawCode, String rawLabel, String rawFingerprint, String clientAddress) {
        Instant now = clock.instant();
        String ipHash = DeviceService.sha256Hex(pepper + "|ip|" + clientAddress);
        String fingerprint = fingerprint(rawFingerprint);

        attempts.deleteOlderThan(now.minus(Duration.ofDays(1)));

        // Checked before the code is even looked at: a locked client that happens
        // to guess right is still refused, so the limit cannot be walked around.
        Instant since = now.minus(window);
        boolean locked = attempts.countByIpAndSucceededFalseAndAtAfter(ipHash, since) >= maxFailures
                || (fingerprint != null
                        && attempts.countByFingerprintAndSucceededFalseAndAtAfter(fingerprint, since) >= maxFailures);
        if (locked) {
            throw new ResponseStatusException(
                    HttpStatus.TOO_MANY_REQUESTS, "Let’s take a little rest. Please try again in a while.");
        }

        String code = normalise(rawCode);
        PairingCode row = code == null ? null : codes.findByCodeHash(hash(code)).orElse(null);
        if (row == null || codes.claim(row.getId(), now) != 1) {
            record(now, ipHash, fingerprint, false);
            // Unknown, expired, used, replaced or malformed: one answer for all of
            // them, so a guess learns nothing about which it was.
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "That code didn’t work.");
        }

        String token = DeviceService.TOKEN_PREFIX + newSecret();
        Device device = new Device();
        device.setPatientId(row.getPatientId());
        device.setLabel(label(rawLabel));
        device.setFingerprint(fingerprint);
        device.setTokenHash(DeviceService.sha256Hex(token));
        device.setPairedAt(now);
        device.setLastSeenAt(now);
        device.setExpiresAt(now.plus(deviceTtl));
        devices.saveAndFlush(device);
        codes.attachDevice(row.getId(), device.getId());

        record(now, ipHash, fingerprint, true);
        audit.record(Actor.DEVICE, device.getId(), "DEVICE_PAIRED", row.getPatientId(), null, null,
                Map.of("label", device.getLabel()));
        log.info("device {} paired", device.getId());
        return new Redemption(token, device.getId(), row.getPatientId(), device.getExpiresAt());
    }

    private void record(Instant now, String ipHash, String fingerprint, boolean success) {
        PairingAttempt a = new PairingAttempt();
        a.setAt(now);
        a.setIp(ipHash);
        a.setFingerprint(fingerprint);
        a.setSucceeded(success);
        attempts.save(a);
    }

    /* ------------------------------------------------------------ helpers */

    String generateCode() {
        StringBuilder sb = new StringBuilder(CODE_LENGTH);
        for (int i = 0; i < CODE_LENGTH; i++) {
            sb.append(ALPHABET.charAt(random.nextInt(ALPHABET.length())));
        }
        return sb.toString();
    }

    /** 256 random bits, URL-safe. */
    private String newSecret() {
        byte[] bytes = new byte[32];
        random.nextBytes(bytes);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
    }

    /**
     * Uppercase, drop spaces and dashes. Returns null for anything that could not
     * have been issued: wrong length, or a symbol outside the alphabet.
     */
    public static String normalise(String raw) {
        if (raw == null) {
            return null;
        }
        String s = raw.toUpperCase(java.util.Locale.ROOT).replaceAll("[\\s-]", "");
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

    /** {@code HJ4K-2M}: how it is shown and read aloud. */
    public static String format(String code) {
        return code.substring(0, 4) + "-" + code.substring(4);
    }

    String hash(String normalisedCode) {
        return DeviceService.sha256Hex(pepper + "|code|" + normalisedCode);
    }

    /** A tablet's own random id: kept only if it looks like one, so it cannot be used to store junk. */
    static String fingerprint(String raw) {
        if (raw == null) {
            return null;
        }
        String s = raw.strip();
        return !s.isEmpty() && s.length() <= FINGERPRINT_MAX && s.matches("[A-Za-z0-9_-]+") ? s : null;
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
}
