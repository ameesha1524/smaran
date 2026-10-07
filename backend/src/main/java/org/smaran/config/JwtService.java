package org.smaran.config;

import io.jsonwebtoken.Claims;
import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.security.Keys;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.util.Date;
import java.util.List;
import javax.crypto.SecretKey;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

/**
 * JWT minting and verification.
 *
 * Access tokens are deliberately short (15 minutes): a stolen one should not be
 * useful by the evening. Refresh is not a JWT at all. It is an opaque random
 * token kept as a hash in the database, so it can rotate, be revoked and be
 * checked for reuse (see AuthService).
 *
 * An access token says who the caller is and what role they hold, and nothing
 * about which patients they may see. That is looked up on every request by
 * AccessGuard, so a token cannot outlive a change of access.
 *
 * The patient's own tablet holds a long-lived token too, because a locked-out
 * dementia patient cannot recover an account — and everything on that device is
 * useless without the device anyway.
 */
@Service
public class JwtService {

    private final SecretKey key;
    private final Duration accessTtl;

    public JwtService(
            @Value("${smaran.security.jwt-secret}") String secret,
            @Value("${smaran.security.access-ttl-minutes:15}") long accessMinutes) {
        this.key = Keys.hmacShaKeyFor(secret.getBytes(StandardCharsets.UTF_8));
        this.accessTtl = Duration.ofMinutes(accessMinutes);
    }

    public String issueAccess(String subject, String role, List<String> patientIds) {
        Instant now = Instant.now();
        return Jwts.builder()
                .subject(subject)
                .claim("role", role)
                .claim("patients", patientIds)
                .issuedAt(Date.from(now))
                .expiration(Date.from(now.plus(accessTtl)))
                .signWith(key)
                .compact();
    }

    /**
     * The tablet's token, minted once when a pairing code is redeemed.
     *
     * It carries the PATIENT role scoped to exactly one patient, and a
     * {@code did} claim naming the pairing row, so that the family removing the
     * tablet ends its access on the next request (see JwtAuthFilter). It is
     * never refreshed: it lasts until it expires or is removed.
     */
    public String issueDevice(String patientId, String deviceId, Instant expiresAt) {
        return Jwts.builder()
                .subject(patientId)
                .claim("role", "PATIENT")
                .claim("patients", List.of(patientId))
                .claim("did", deviceId)
                .claim("typ", "device")
                .issuedAt(Date.from(Instant.now()))
                .expiration(Date.from(expiresAt))
                .signWith(key)
                .compact();
    }

    /** Returns null rather than throwing: an invalid token is just anonymous. */
    public Claims parse(String token) {
        try {
            return Jwts.parser().verifyWith(key).build().parseSignedClaims(token).getPayload();
        } catch (Exception e) {
            return null;
        }
    }

    public boolean isRefresh(Claims claims) {
        return claims != null && "refresh".equals(claims.get("typ", String.class));
    }
}
