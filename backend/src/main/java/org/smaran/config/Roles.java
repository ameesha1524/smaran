package org.smaran.config;

import java.util.Arrays;
import org.smaran.config.JwtAuthFilter.SmaranPrincipal;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Component;

/**
 * Used in {@code @PreAuthorize("@roles.any('CAREGIVER', 'ADMIN')")}: the coarse
 * "is this kind of user allowed here at all" layer of method security. Which
 * patient is then decided in AccessGuard, which is why both exist.
 *
 * With {@code smaran.security.open-demo} on (the dev profile only) everything
 * passes, as it does everywhere else in that profile.
 */
@Component("roles")
public class Roles {

    private final boolean openDemo;

    public Roles(@Value("${smaran.security.open-demo:false}") boolean openDemo) {
        this.openDemo = openDemo;
    }

    public boolean any(String... allowed) {
        if (openDemo) {
            return true;
        }
        Authentication auth = SecurityContextHolder.getContext().getAuthentication();
        if (auth == null || !(auth.getPrincipal() instanceof SmaranPrincipal principal)) {
            return false;
        }
        return Arrays.asList(allowed).contains(principal.role());
    }
}
