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
 * Access tokens are deliberately short (15 minutes) and refresh tokens long
 * (7 days): a caregiver's phone in a hospital corridor should not be asking for
 * a password, and a stolen access token should not be useful by the evening.
 *
 * The patient's own tablet holds a long-lived token too, because a locked-out
 * dementia patient cannot recover an account — and everything on that device is
 * useless without the device anyway.
 */
@Service
public class JwtService {

    private final SecretKey key;
    private final Duration accessTtl;
    private final Duration refreshTtl;

    public JwtService(
            @Value("${smaran.security.jwt-secret}") String secret,
            @Value("${smaran.security.access-ttl-minutes:15}") long accessMinutes,
            @Value("${smaran.security.refresh-ttl-days:7}") long refreshDays) {
        this.key = Keys.hmacShaKeyFor(secret.getBytes(StandardCharsets.UTF_8));
        this.accessTtl = Duration.ofMinutes(accessMinutes);
        this.refreshTtl = Duration.ofDays(refreshDays);
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

    public String issueRefresh(String subject) {
        Instant now = Instant.now();
        return Jwts.builder()
                .subject(subject)
                .claim("typ", "refresh")
                .issuedAt(Date.from(now))
                .expiration(Date.from(now.plus(refreshTtl)))
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
