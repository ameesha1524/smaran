package org.smaran.service;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.Base64;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.regex.Pattern;
import lombok.extern.slf4j.Slf4j;
import org.smaran.config.JwtService;
import org.smaran.domain.AppUser;
import org.smaran.domain.AppUser.Status;
import org.smaran.domain.Enums.Role;
import org.smaran.domain.RefreshToken;
import org.smaran.repo.AppUserRepository;
import org.smaran.repo.PatientRepository;
import org.smaran.repo.RefreshTokenRepository;
import org.smaran.service.AuditService.Actor;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

/**
 * Accounts and sessions: registration, sign-in, refresh, sign-out.
 *
 * <b>Sign-in</b> answers every failure the same way: a wrong password, an
 * unknown email, a locked account and a disabled account all give the same 401
 * and the same words, and a hash comparison runs in every case so the paths
 * cannot be told apart by timing. Five wrong passwords lock the account for 15
 * minutes. That lock can itself be used to keep a known email from signing in;
 * the per-address limit in {@link AttemptLimiter} is the mitigation, and the
 * trade-off is stated in docs/explainers/phase-2.md.
 *
 * <b>Refresh tokens</b> are 256 random bits, stored only as a SHA-256. Using one
 * rotates it. Using one that was already used revokes its whole family: the
 * only way a used token comes back is that someone copied it.
 *
 * The class is transactional with {@code noRollbackFor} the status exceptions,
 * on purpose: a failed sign-in must still record its failure, and a detected
 * reuse must still revoke the family, even though both end in a 401.
 */
@Service
@Slf4j
@Transactional(noRollbackFor = ResponseStatusException.class)
public class AuthService {

    static final String MESSAGE_FAILED = "Those details did not match.";
    private static final Pattern EMAIL = Pattern.compile("^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$");
    /** Computed once: a real BCrypt hash to compare against when the email is unknown. */
    private final String decoyHash;

    private static final SecureRandom RANDOM = new SecureRandom();

    /** What a successful sign-in or refresh hands back. */
    public record Session(String accessToken, String refreshToken, Instant refreshExpiresAt, AppUser user) {
    }

    /** Registering either signs the caregiver in, or leaves a doctor waiting for approval. */
    public record Registered(AppUser user, Session session) {
    }

    private final AppUserRepository users;
    private final RefreshTokenRepository refreshTokens;
    private final PatientRepository patients;
    private final PasswordEncoder encoder;
    private final JwtService jwt;
    private final AuditService audit;
    private final AttemptLimiter loginLimiter;
    private final AttemptLimiter registerLimiter;
    private final Clock clock;
    private final int maxFailures;
    private final Duration lockout;
    private final Duration refreshTtl;

    public AuthService(
            AppUserRepository users,
            RefreshTokenRepository refreshTokens,
            PatientRepository patients,
            PasswordEncoder encoder,
            JwtService jwt,
            AuditService audit,
            Clock clock,
            @Value("${smaran.auth.max-failures:5}") int maxFailures,
            @Value("${smaran.auth.lockout-minutes:15}") long lockoutMinutes,
            @Value("${smaran.auth.ip-max-failures:20}") int ipMaxFailures,
            @Value("${smaran.auth.ip-window-minutes:15}") long ipWindowMinutes,
            @Value("${smaran.auth.register-max-per-hour:10}") int registerMax,
            @Value("${smaran.security.refresh-ttl-days:7}") long refreshDays) {
        this.users = users;
        this.refreshTokens = refreshTokens;
        this.patients = patients;
        this.encoder = encoder;
        this.jwt = jwt;
        this.audit = audit;
        this.clock = clock;
        this.maxFailures = maxFailures;
        this.lockout = Duration.ofMinutes(lockoutMinutes);
        this.refreshTtl = Duration.ofDays(refreshDays);
        this.loginLimiter = new AttemptLimiter(ipMaxFailures, Duration.ofMinutes(ipWindowMinutes), clock);
        this.registerLimiter = new AttemptLimiter(registerMax, Duration.ofHours(1), clock);
        this.decoyHash = encoder.encode("decoy-" + UUID.randomUUID());
    }

    /* ------------------------------------------------------------ register */

    public Registered register(String name, String email, String password, String roleName, String phone, String ip) {
        if (!registerLimiter.tryRecord(ip)) {
            throw new ResponseStatusException(HttpStatus.TOO_MANY_REQUESTS, "Too many sign-ups from here. Try again later.");
        }
        String cleanEmail = email == null ? "" : email.trim().toLowerCase();
        if (!EMAIL.matcher(cleanEmail).matches() || cleanEmail.length() > 254) {
            throw bad("Enter a valid email address.");
        }
        String cleanName = name == null ? "" : name.trim();
        if (cleanName.isEmpty() || cleanName.length() > 200) {
            throw bad("Enter your name.");
        }
        Role role = parseRegistrationRole(roleName);
        List<String> problems = PasswordPolicy.problems(password, cleanEmail);
        if (!problems.isEmpty()) {
            throw bad(String.join(" ", problems));
        }
        if (users.existsByEmail(cleanEmail)) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "That email already has an account.");
        }

        AppUser user = new AppUser();
        user.setEmail(cleanEmail);
        user.setName(cleanName);
        user.setPhone(phone == null || phone.isBlank() ? null : phone.trim());
        user.setPasswordHash(encoder.encode(password));
        user.setRole(role);
        // A doctor sees nothing until an admin approves them. A caregiver sees
        // only their own patients, and has none yet.
        user.setStatus(role == Role.DOCTOR ? Status.PENDING : Status.ACTIVE);
        user = users.save(user);
        audit.record(actorOf(role), user.getId(), "REGISTER", null, null, ip, Map.of("role", role.name()));

        Session session = user.getStatus() == Status.ACTIVE ? startSession(user, UUID.randomUUID().toString()) : null;
        return new Registered(user, session);
    }

    private static Role parseRegistrationRole(String roleName) {
        // Admins are never self-registered; they are created from the environment or by another admin.
        if ("DOCTOR".equalsIgnoreCase(roleName)) {
            return Role.DOCTOR;
        }
        if (roleName == null || roleName.isBlank() || "CAREGIVER".equalsIgnoreCase(roleName)) {
            return Role.CAREGIVER;
        }
        throw bad("Choose caregiver or doctor.");
    }

    /* --------------------------------------------------------------- login */

    public Session login(String email, String password, String ip) {
        if (!loginLimiter.allowed(ip)) {
            throw new ResponseStatusException(HttpStatus.TOO_MANY_REQUESTS, "Too many attempts. Try again later.");
        }
        String cleanEmail = email == null ? "" : email.trim().toLowerCase();
        AppUser user = users.findByEmail(cleanEmail).orElse(null);

        // Always compare against a real hash, so a missing account takes as
        // long as a wrong password.
        boolean passwordOk = encoder.matches(password == null ? "" : password, user != null ? user.getPasswordHash() : decoyHash);
        Instant now = clock.instant();

        if (user == null) {
            loginLimiter.record(ip);
            audit.record(Actor.ANONYMOUS, null, "LOGIN_FAILED", null, null, ip, Map.of("why", "no-account"));
            throw failed();
        }
        if (user.getLockedUntil() != null && user.getLockedUntil().isAfter(now)) {
            // Same answer as a wrong password, even for the right one.
            loginLimiter.record(ip);
            audit.record(actorOf(user.getRole()), user.getId(), "LOGIN_FAILED", null, null, ip, Map.of("why", "locked"));
            throw failed();
        }
        if (!passwordOk) {
            loginLimiter.record(ip);
            users.recordFailure(user.getId());
            AppUser fresh = users.findById(user.getId()).orElse(user);
            boolean nowLocked = fresh.getFailedLogins() >= maxFailures;
            if (nowLocked) {
                users.lock(user.getId(), now.plus(lockout));
            }
            audit.record(actorOf(user.getRole()), user.getId(), "LOGIN_FAILED", null, null, ip,
                    Map.of("why", "bad-password", "locked", nowLocked));
            throw failed();
        }
        if (user.getStatus() == Status.DISABLED) {
            audit.record(actorOf(user.getRole()), user.getId(), "LOGIN_FAILED", null, null, ip, Map.of("why", "disabled"));
            throw failed();
        }
        if (user.getStatus() == Status.PENDING) {
            // They proved they know the password, so saying so leaks nothing.
            audit.record(actorOf(user.getRole()), user.getId(), "LOGIN_PENDING", null, null, ip, null);
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Your account is waiting for an administrator to approve it.");
        }

        users.recordSuccess(user.getId(), now);
        audit.record(actorOf(user.getRole()), user.getId(), "LOGIN", null, null, ip, null);
        return startSession(user, UUID.randomUUID().toString());
    }

    /* ------------------------------------------------------------- refresh */

    public Session refresh(String presented, String ip) {
        if (presented == null || presented.isBlank()) {
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED);
        }
        Instant now = clock.instant();
        RefreshToken token = refreshTokens.findByTokenHash(sha256(presented)).orElse(null);
        if (token == null) {
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED);
        }
        if (token.getRevokedAt() != null) {
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED);
        }

        // Exactly one request can win this; see RefreshTokenRepository#markUsed.
        if (refreshTokens.markUsed(token.getId(), now) == 0) {
            RefreshToken current = refreshTokens.findById(token.getId()).orElse(token);
            if (current.getUsedAt() != null) {
                // Already used: a copy exists that should not. End the family.
                refreshTokens.revokeFamily(token.getFamilyId(), now);
                audit.record(Actor.SYSTEM, token.getUserId(), "REFRESH_REUSE", null, null, ip,
                        Map.of("family", token.getFamilyId()));
                log.warn("refresh token reuse detected for user {}; family revoked", token.getUserId());
            }
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED);
        }

        AppUser user = users.findById(token.getUserId()).orElse(null);
        if (user == null || user.getStatus() != Status.ACTIVE) {
            refreshTokens.revokeFamily(token.getFamilyId(), now);
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED);
        }
        return startSession(user, token.getFamilyId());
    }

    /* -------------------------------------------------------------- logout */

    /** Ends the session the presented token belongs to. Quiet if there is nothing to end. */
    public void logout(String presented, String ip) {
        if (presented == null || presented.isBlank()) {
            return;
        }
        refreshTokens.findByTokenHash(sha256(presented)).ifPresent(token -> {
            refreshTokens.revokeFamily(token.getFamilyId(), clock.instant());
            audit.record(Actor.SYSTEM, token.getUserId(), "LOGOUT", null, null, ip, null);
        });
    }

    /* ------------------------------------------------------------ plumbing */

    public AppUser requireUser(String userId) {
        return users.findById(userId).orElseThrow(() -> new ResponseStatusException(HttpStatus.UNAUTHORIZED));
    }

    public List<String> ownedPatientIds(AppUser user) {
        return user.getRole() == Role.CAREGIVER
                ? patients.findByCaregiverId(user.getId()).stream().map(p -> p.getId()).toList()
                : List.of();
    }

    private Session startSession(AppUser user, String familyId) {
        Instant now = clock.instant();
        String raw = newToken();
        RefreshToken stored = new RefreshToken();
        stored.setUserId(user.getId());
        stored.setFamilyId(familyId);
        stored.setTokenHash(sha256(raw));
        stored.setIssuedAt(now);
        stored.setExpiresAt(now.plus(refreshTtl));
        refreshTokens.save(stored);
        String access = jwt.issueAccess(user.getId(), user.getRole().name(), List.of());
        return new Session(access, raw, stored.getExpiresAt(), user);
    }

    static String newToken() {
        byte[] bytes = new byte[32];
        RANDOM.nextBytes(bytes);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
    }

    static String sha256(String value) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8)));
        } catch (java.security.NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }

    private static ResponseStatusException failed() {
        return new ResponseStatusException(HttpStatus.UNAUTHORIZED, MESSAGE_FAILED);
    }

    private static ResponseStatusException bad(String message) {
        return new ResponseStatusException(HttpStatus.BAD_REQUEST, message);
    }

    private static Actor actorOf(Role role) {
        return switch (role) {
            case ADMIN -> Actor.ADMIN;
            case DOCTOR -> Actor.DOCTOR;
            default -> Actor.CAREGIVER;
        };
    }
}
