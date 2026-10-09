package org.smaran.config;

import java.time.Clock;
import java.util.Map;
import org.smaran.config.JwtAuthFilter.SmaranPrincipal;
import org.smaran.repo.DoctorGrantRepository;
import org.smaran.repo.PatientRepository;
import org.smaran.service.AuditService;
import org.smaran.service.AuditService.Actor;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Component;
import org.springframework.web.context.request.RequestAttributes;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;
import org.springframework.web.server.ResponseStatusException;

/**
 * One question, asked in every controller that touches a patient:
 * <em>may this caller do this to this patient?</em>
 *
 * Two things are checked, in this order, and the order is deliberate:
 *
 * <ol>
 *   <li><b>Is this kind of user allowed this kind of action at all?</b> The
 *       answer is 403, and it does not depend on any patient, so it tells the
 *       caller nothing about who exists.</li>
 *   <li><b>Is this particular patient theirs to touch?</b> If not, 404 — the
 *       same answer as for a patient who does not exist, so ids cannot be
 *       enumerated.</li>
 * </ol>
 *
 * Ownership is never read from the token. A caregiver owns the patients whose
 * {@code caregiver_id} is theirs; a doctor reaches the patients with a live
 * grant. Both are looked up here on every request, so ending a grant or moving
 * a patient takes effect on the next call, and a token cannot carry a stale
 * list. A tablet is the one exception: its token names its one patient, and
 * JwtAuthFilter confirms on every request that the tablet has not been removed.
 *
 * Every decision by a person (not a tablet) is written to the audit log.
 */
@Component
public class AccessGuard {

    /** What the caller wants to do. Each endpoint declares exactly one. */
    public enum Capability {
        /** Set the patient up and manage her access: pairing, grants, her objects and family. */
        CAREGIVE,
        /** What her own tablet does, and what her family can do on her behalf: play, sync, read her profile. */
        PLAY,
        /** Read the dashboard, the report and the trends. The only thing a doctor may do. */
        CLINICAL_READ
    }

    private final boolean openDemo;
    private final PatientRepository patients;
    private final DoctorGrantRepository grants;
    private final AuditService audit;
    private final Clock clock;

    public AccessGuard(
            @Value("${smaran.security.open-demo:false}") boolean openDemo,
            PatientRepository patients,
            DoctorGrantRepository grants,
            AuditService audit,
            Clock clock) {
        this.openDemo = openDemo;
        this.patients = patients;
        this.grants = grants;
        this.audit = audit;
        this.clock = clock;
    }

    /**
     * Allows the call or throws: 401 with no valid sign-in, 403 for the wrong
     * kind of user, 404 for a patient that is not theirs.
     *
     * @return who is calling, so the controller can record it
     */
    public SmaranPrincipal require(String patientId, Capability capability) {
        SmaranPrincipal principal = current();
        if (openDemo) {
            // `dev` profile only: lets the PWA and a demo run with no accounts.
            return principal != null ? principal : new SmaranPrincipal("open-demo", "ADMIN", java.util.List.of());
        }
        if (principal == null) {
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED);
        }

        if (!roleMayDo(principal.role(), capability)) {
            denied(principal, patientId, capability, "role");
            throw new ResponseStatusException(HttpStatus.FORBIDDEN);
        }

        if (!isTheirs(principal, patientId, capability)) {
            denied(principal, patientId, capability, "not-theirs");
            // 404, not 403: whether this patient exists is itself information.
            throw new ResponseStatusException(HttpStatus.NOT_FOUND);
        }

        recordAllowed(principal, patientId, capability);
        return principal;
    }

    /** The role part of the rule, with no patient involved. */
    static boolean roleMayDo(String role, Capability capability) {
        return switch (role == null ? "" : role) {
            case "ADMIN", "CAREGIVER" -> true;
            case "DOCTOR" -> capability == Capability.CLINICAL_READ && isReadRequest();
            case "PATIENT" -> capability == Capability.PLAY;
            default -> false;
        };
    }

    private boolean isTheirs(SmaranPrincipal principal, String patientId, Capability capability) {
        return switch (principal.role()) {
            // An admin may reach any patient that exists; one that does not is a 404 like any other.
            case "ADMIN" -> patients.existsById(patientId);
            case "CAREGIVER" -> patients.existsByIdAndCaregiverId(patientId, principal.userId());
            case "DOCTOR" -> grants.existsLive(patientId, principal.userId(), clock.instant());
            case "PATIENT" -> principal.patientIds().contains(patientId);
            default -> false;
        };
    }

    public SmaranPrincipal current() {
        Authentication auth = SecurityContextHolder.getContext().getAuthentication();
        if (auth == null || !(auth.getPrincipal() instanceof SmaranPrincipal principal)) {
            return null;
        }
        return principal;
    }

    /** The signed-in user's id, or 401. For endpoints that act as the caller rather than on a patient. */
    public String currentUserId() {
        SmaranPrincipal principal = current();
        if (principal == null) {
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED);
        }
        return principal.userId();
    }

    public boolean isOpenDemo() {
        return openDemo;
    }

    /* --------------------------------------------------------------- audit */

    private void recordAllowed(SmaranPrincipal principal, String patientId, Capability capability) {
        Actor actor = actorOf(principal.role());
        if (actor == Actor.DEVICE) {
            // A tablet makes a request every few seconds; recording each would
            // bury the entries that matter. Its pairing and removal are audited.
            return;
        }
        audit.record(actor, principal.userId(), isReadRequest() ? "PATIENT_READ" : "PATIENT_WRITE",
                patientId, resource(), ip(), Map.of("capability", capability.name()));
    }

    private void denied(SmaranPrincipal principal, String patientId, Capability capability, String why) {
        audit.record(actorOf(principal.role()), principal.userId(), "ACCESS_DENIED", patientId, resource(), ip(),
                Map.of("capability", capability.name(), "why", why));
    }

    static Actor actorOf(String role) {
        return switch (role == null ? "" : role) {
            case "ADMIN" -> Actor.ADMIN;
            case "CAREGIVER" -> Actor.CAREGIVER;
            case "DOCTOR" -> Actor.DOCTOR;
            case "PATIENT" -> Actor.DEVICE;
            default -> Actor.ANONYMOUS;
        };
    }

    /* ----------------------------------------------------- the request */

    private static jakarta.servlet.http.HttpServletRequest request() {
        RequestAttributes attrs = RequestContextHolder.getRequestAttributes();
        return attrs instanceof ServletRequestAttributes s ? s.getRequest() : null;
    }

    /** Reads and the SSE stream are reads; everything else is a write. No request counts as a read. */
    private static boolean isReadRequest() {
        var r = request();
        if (r == null) {
            return true;
        }
        HttpMethod m = HttpMethod.valueOf(r.getMethod());
        return m == HttpMethod.GET || m == HttpMethod.HEAD;
    }

    private static String resource() {
        var r = request();
        return r == null ? null : r.getMethod() + " " + r.getRequestURI();
    }

    private static String ip() {
        var r = request();
        return r == null ? null : r.getRemoteAddr();
    }
}
