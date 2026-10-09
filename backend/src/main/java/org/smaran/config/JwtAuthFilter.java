package org.smaran.config;

import io.jsonwebtoken.Claims;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.util.List;
import java.util.Set;
import org.smaran.service.DeviceService;
import org.springframework.context.annotation.Lazy;
import org.springframework.lang.NonNull;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

/**
 * Reads the bearer token and puts a principal in the context.
 *
 * There are two kinds of token and they look different on purpose:
 *
 * <ul>
 *   <li>A <b>person's</b> access token is a short-lived JWT. It says who they are
 *       and what role they hold, never which patients they may see; that is
 *       decided by {@link AccessGuard} on every request.</li>
 *   <li>A <b>tablet's</b> device token is opaque, starts {@code sdt_}, and is
 *       looked up by its hash. A tablet the family removed is anonymous from its
 *       next request.</li>
 * </ul>
 *
 * Anything else, including an old-style tablet JWT or a token with an unknown
 * role, leaves the request anonymous.
 */
@Component
public class JwtAuthFilter extends OncePerRequestFilter {

    private static final Set<String> PERSON_ROLES = Set.of("ADMIN", "CAREGIVER", "DOCTOR");

    private final JwtService jwt;
    private final DeviceService devices;

    // Lazy: the filter is built with the security chain, before the JPA layer
    // DeviceService sits on needs to exist.
    public JwtAuthFilter(JwtService jwt, @Lazy DeviceService devices) {
        this.jwt = jwt;
        this.devices = devices;
    }

    @Override
    protected void doFilterInternal(
            @NonNull HttpServletRequest request,
            @NonNull HttpServletResponse response,
            @NonNull FilterChain chain)
            throws ServletException, IOException {

        String header = request.getHeader("Authorization");
        if (header != null && header.startsWith("Bearer ")) {
            String token = header.substring(7).strip();
            SmaranPrincipal principal = token.startsWith(DeviceService.TOKEN_PREFIX)
                    ? deviceOf(token)
                    : personOf(token);
            if (principal != null) {
                var auth = new UsernamePasswordAuthenticationToken(
                        principal, null, List.of(new SimpleGrantedAuthority("ROLE_" + principal.role())));
                SecurityContextHolder.getContext().setAuthentication(auth);
            }
        }

        chain.doFilter(request, response);
    }

    private SmaranPrincipal deviceOf(String token) {
        return devices.authenticate(token)
                .map(d -> new SmaranPrincipal(d.deviceId(), "DEVICE", List.of(d.patientId())))
                .orElse(null);
    }

    private SmaranPrincipal personOf(String token) {
        Claims claims = jwt.parse(token);
        if (claims == null || jwt.isRefresh(claims)) {
            return null;
        }
        String role = claims.get("role", String.class);
        if (!PERSON_ROLES.contains(role)) {
            return null;
        }
        @SuppressWarnings("unchecked")
        List<String> patients = claims.get("patients", List.class);
        return new SmaranPrincipal(claims.getSubject(), role, patients == null ? List.of() : patients);
    }

    /**
     * Who is calling. For a tablet, {@code userId} is the device id and
     * {@code patientIds} holds exactly the one patient it was paired to.
     */
    public record SmaranPrincipal(String userId, String role, List<String> patientIds) {
    }
}
