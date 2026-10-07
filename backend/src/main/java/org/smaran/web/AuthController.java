package org.smaran.web;

import jakarta.servlet.http.Cookie;
import jakarta.servlet.http.HttpServletRequest;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import org.smaran.config.AccessGuard;
import org.smaran.config.JwtAuthFilter.SmaranPrincipal;
import org.smaran.domain.AppUser;
import org.smaran.service.AuthService;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseCookie;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

/**
 * Sign-up, sign-in, refresh, sign-out, and "who am I".
 *
 * The access token (15 minutes) is returned in the body and the browser keeps it
 * in memory. The refresh token never appears in a body: it is set as an
 * HttpOnly, SameSite=Strict cookie scoped to this path, so script cannot read
 * it and a request from another site does not carry it.
 */
@RestController
@RequestMapping("/api/auth")
public class AuthController {

    static final String REFRESH_COOKIE = "smaran_rt";
    private static final String COOKIE_PATH = "/api/auth";

    private final AuthService auth;
    private final AccessGuard guard;
    private final boolean cookieSecure;

    public AuthController(
            AuthService auth, AccessGuard guard, @Value("${smaran.security.cookie-secure:true}") boolean cookieSecure) {
        this.auth = auth;
        this.guard = guard;
        this.cookieSecure = cookieSecure;
    }

    @PostMapping("/register")
    public ResponseEntity<Dto.RegisterResponse> register(@RequestBody Dto.RegisterRequest body, HttpServletRequest request) {
        AuthService.Registered result = auth.register(
                body.name(), body.email(), body.password(), body.role(), body.phone(), request.getRemoteAddr());
        AppUser user = result.user();
        if (result.session() == null) {
            return ResponseEntity.status(HttpStatus.CREATED).body(new Dto.RegisterResponse(
                    user.getId(), user.getStatus().name(),
                    "Thank you. An administrator will approve your account before you can sign in.", null));
        }
        return withCookie(HttpStatus.CREATED, result.session(), session -> new Dto.RegisterResponse(
                user.getId(), user.getStatus().name(), "Welcome.", loginBody(session)));
    }

    @PostMapping("/login")
    public ResponseEntity<Dto.LoginResponse> login(@RequestBody Dto.LoginRequest body, HttpServletRequest request) {
        AuthService.Session session = auth.login(body.email(), body.password(), request.getRemoteAddr());
        return withCookie(HttpStatus.OK, session, this::loginBody);
    }

    @PostMapping("/refresh")
    public ResponseEntity<Dto.LoginResponse> refresh(HttpServletRequest request) {
        AuthService.Session session = auth.refresh(cookie(request), request.getRemoteAddr());
        return withCookie(HttpStatus.OK, session, this::loginBody);
    }

    @PostMapping("/logout")
    public ResponseEntity<Void> logout(HttpServletRequest request) {
        auth.logout(cookie(request), request.getRemoteAddr());
        return ResponseEntity.noContent().header(HttpHeaders.SET_COOKIE, clearedCookie().toString()).build();
    }

    @GetMapping("/me")
    public Dto.MeResponse me() {
        SmaranPrincipal principal = guard.current();
        if (principal == null || "PATIENT".equals(principal.role())) {
            // A tablet is not a user: it has no account to describe.
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED);
        }
        AppUser user = auth.requireUser(principal.userId());
        return new Dto.MeResponse(
                user.getId(), user.getName(), user.getEmail(), user.getRole().name(), user.getStatus().name(),
                auth.ownedPatientIds(user));
    }

    /* ------------------------------------------------------------- helpers */

    private Dto.LoginResponse loginBody(AuthService.Session session) {
        AppUser user = session.user();
        List<String> patientIds = auth.ownedPatientIds(user);
        return new Dto.LoginResponse(
                session.accessToken(), user.getRole().name(), user.getId(), user.getName(), user.getStatus().name(), patientIds);
    }

    private <T> ResponseEntity<T> withCookie(
            HttpStatus status, AuthService.Session session, java.util.function.Function<AuthService.Session, T> body) {
        return ResponseEntity.status(status)
                .header(HttpHeaders.SET_COOKIE, refreshCookie(session.refreshToken(), session.refreshExpiresAt()).toString())
                .header(HttpHeaders.CACHE_CONTROL, "no-store")
                .body(body.apply(session));
    }

    private ResponseCookie refreshCookie(String value, Instant expires) {
        return ResponseCookie.from(REFRESH_COOKIE, value)
                .httpOnly(true)
                .secure(cookieSecure)
                .sameSite("Strict")
                .path(COOKIE_PATH)
                .maxAge(Duration.between(Instant.now(), expires))
                .build();
    }

    private ResponseCookie clearedCookie() {
        return ResponseCookie.from(REFRESH_COOKIE, "")
                .httpOnly(true)
                .secure(cookieSecure)
                .sameSite("Strict")
                .path(COOKIE_PATH)
                .maxAge(0)
                .build();
    }

    private static String cookie(HttpServletRequest request) {
        if (request.getCookies() == null) {
            return null;
        }
        for (Cookie c : request.getCookies()) {
            if (REFRESH_COOKIE.equals(c.getName())) {
                return c.getValue();
            }
        }
        return null;
    }
}
