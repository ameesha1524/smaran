package org.smaran.config;

import org.smaran.config.JwtAuthFilter.SmaranPrincipal;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ResponseStatusException;

/**
 * One question, asked in every controller that touches a patient:
 * <em>may this caller see this patient?</em>
 *
 * A caregiver sees the patients assigned to them and no one else's. An admin
 * sees everything, and that is audited. A patient's own device sees itself.
 *
 * This is a single method rather than a web of annotations on purpose — the
 * rule is the same everywhere, and it should be readable in one place by
 * whoever is checking whether it is true.
 */
@Component
public class AccessGuard {

    private final boolean openDemo;

    public AccessGuard(@Value("${smaran.security.open-demo:false}") boolean openDemo) {
        this.openDemo = openDemo;
    }

    public void requireAccessTo(String patientId) {
        if (openDemo) {
            // `dev` profile only: lets the PWA and a demo run with no accounts.
            // Never enable this on anything holding a real person's data.
            return;
        }
        SmaranPrincipal principal = current();
        if (principal == null) {
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED);
        }
        if ("ADMIN".equals(principal.role())) {
            return;
        }
        if (principal.userId().equals(patientId)) {
            return;
        }
        if (!principal.patientIds().contains(patientId)) {
            // 404, not 403: whether this patient exists is itself information.
            throw new ResponseStatusException(HttpStatus.NOT_FOUND);
        }
    }

    public SmaranPrincipal current() {
        Authentication auth = SecurityContextHolder.getContext().getAuthentication();
        if (auth == null || !(auth.getPrincipal() instanceof SmaranPrincipal principal)) {
            return null;
        }
        return principal;
    }

    public boolean isOpenDemo() {
        return openDemo;
    }
}
