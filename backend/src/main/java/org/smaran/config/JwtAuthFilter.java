package org.smaran.config;

import io.jsonwebtoken.Claims;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.util.List;
import org.springframework.lang.NonNull;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

/**
 * Reads the bearer token and puts a principal in the context.
 *
 * The `patients` claim travels on the token so that every controller can answer
 * "may this person see this patient?" without another database round trip. The
 * check itself lives in {@link AccessGuard} — a claim on a token is evidence,
 * not permission.
 */
@Component
public class JwtAuthFilter extends OncePerRequestFilter {

    private final JwtService jwt;

    public JwtAuthFilter(JwtService jwt) {
        this.jwt = jwt;
    }

    @Override
    protected void doFilterInternal(
            @NonNull HttpServletRequest request,
            @NonNull HttpServletResponse response,
            @NonNull FilterChain chain)
            throws ServletException, IOException {

        String header = request.getHeader("Authorization");
        if (header != null && header.startsWith("Bearer ")) {
            Claims claims = jwt.parse(header.substring(7));
            if (claims != null && !jwt.isRefresh(claims)) {
                String role = claims.get("role", String.class);
                @SuppressWarnings("unchecked")
                List<String> patients = claims.get("patients", List.class);
                var principal = new SmaranPrincipal(claims.getSubject(), role, patients == null ? List.of() : patients);
                var auth = new UsernamePasswordAuthenticationToken(
                        principal, null, List.of(new SimpleGrantedAuthority("ROLE_" + role)));
                SecurityContextHolder.getContext().setAuthentication(auth);
            }
        }

        chain.doFilter(request, response);
    }

    /** Who is calling, and which patients they were granted at login. */
    public record SmaranPrincipal(String userId, String role, List<String> patientIds) {
    }
}
