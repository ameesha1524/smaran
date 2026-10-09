package org.smaran.service;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import org.smaran.domain.Device;
import org.smaran.repo.DeviceRepository;
import org.smaran.service.AuditService.Actor;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

/**
 * Paired tablets after pairing: recognising one by its token, listing them for
 * the family, and removing one.
 *
 * The token is an opaque random string. Only its SHA-256 is stored, and it is
 * looked up by that hash, so there is no comparison of the secret itself whose
 * timing could say how much of a guess was right.
 *
 * Whether a tablet is still honoured is read from the database on every
 * request, with no cache: removing a tablet takes effect on its next call, on
 * every server.
 */
@Service
public class DeviceService {

    /** Marks a device token, so the auth filter can tell it from a person's JWT without parsing either. */
    public static final String TOKEN_PREFIX = "sdt_";

    /** last_seen_at is for "is the tablet alive", not an access log; ten-minute grain is plenty. */
    static final Duration SEEN_GRAIN = Duration.ofMinutes(10);

    /** Who a valid token belongs to. */
    public record Authenticated(String deviceId, String patientId) {
    }

    private final DeviceRepository devices;
    private final AuditService audit;
    private final Clock clock;
    private final Duration deviceTtl;

    public DeviceService(
            DeviceRepository devices,
            AuditService audit,
            Clock clock,
            @Value("${smaran.pairing.device-ttl-days:180}") long deviceTtlDays) {
        this.devices = devices;
        this.audit = audit;
        this.clock = clock;
        this.deviceTtl = Duration.ofDays(deviceTtlDays);
    }

    /** The tablet this token belongs to, if it is still honoured. */
    public Optional<Authenticated> authenticate(String token) {
        if (token == null || !token.startsWith(TOKEN_PREFIX)) {
            return Optional.empty();
        }
        Instant now = clock.instant();
        return devices.findByTokenHash(sha256Hex(token))
                .filter(d -> d.isActive(now))
                .map(d -> {
                    devices.touch(d.getId(), now, now.minus(SEEN_GRAIN), now.plus(deviceTtl));
                    return new Authenticated(d.getId(), d.getPatientId());
                });
    }

    /** Tablets that currently hold a live token for her. */
    public List<Device> forPatient(String patientId) {
        return devices.findByPatientIdAndRevokedAtIsNullAndExpiresAtAfterOrderByPairedAtDesc(patientId, clock.instant());
    }

    /**
     * Ends a tablet's access on its next request. Her information stays: this
     * removes the way in, not what is behind it. Removing one twice is fine.
     */
    @Transactional
    public void revoke(String patientId, String deviceId, String byUserId) {
        Device device = devices.findByIdAndPatientId(deviceId, patientId)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND));
        if (devices.revoke(deviceId, patientId, clock.instant()) == 1) {
            audit.record(Actor.CAREGIVER, byUserId, "DEVICE_REVOKED", patientId, null, null,
                    Map.of("deviceId", device.getId()));
        }
    }

    public static String sha256Hex(String value) {
        try {
            return HexFormat.of().formatHex(
                    MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException("SHA-256 unavailable", e);
        }
    }
}
