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
 * A tablet never passes {@link #require}; it has its own endpoints under
 * /api/device, which use {@link #requireDevice}.
 *
 * Every decision by a person (not a tablet) is written to the audit log.
 */
@Component
public class AccessGuard {

    /** What the caller wants to do. Each endpoint declares exactly one. */
    public enum Capability {
        /** Set the patient up and manage her access: pairing, grants, her objects and family. */
        CAREGIVE,
        /** Read the dashboard, the report and the trends. The only thing a doctor may do. */
        CLINICAL_READ
    }

    private static final java.time.Duration READ_COALESCE = java.time.Duration.ofSeconds(60);

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

        if (!roleMayDo(principal.role(), capability, isReadRequest())) {
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

    /**
     * For /api/device/**: the caller must be a paired tablet, and the patient is
     * whichever one it was paired to. There is no patient id to pass, so there is
     * nothing for a tablet to get wrong or to point at someone else.
     *
     * @return the tablet's principal; {@code patientIds().get(0)} is her
     */
    public SmaranPrincipal requireDevice() {
        SmaranPrincipal principal = current();
        if (principal == null) {
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED);
        }
        if (!"DEVICE".equals(principal.role()) || principal.patientIds().size() != 1) {
            denied(principal, null, null, "not-a-device");
            throw new ResponseStatusException(HttpStatus.FORBIDDEN);
        }
        return principal;
    }

    /**
     * The same rule as {@link #require}, as a yes or no, for a caller who is not in
     * the current request (a live stream checking, before each event, that its
     * reader still may). Not audited: nothing is being read by asking.
     */
    public boolean allows(SmaranPrincipal principal, String patientId, Capability capability) {
        if (principal == null || !roleMayDo(principal.role(), capability, true)) {
            return false;
        }
        return isTheirs(principal, patientId, capability);
    }

    /** The role part of the rule, with no patient involved. */
    static boolean roleMayDo(String role, Capability capability, boolean isRead) {
        return switch (role == null ? "" : role) {
            case "ADMIN", "CAREGIVER" -> true;
            case "DOCTOR" -> capability == Capability.CLINICAL_READ && isRead;
            // A tablet has its own endpoints under /api/device and no business anywhere else.
            default -> false;
        };
    }

    private boolean isTheirs(SmaranPrincipal principal, String patientId, Capability capability) {
        return switch (principal.role()) {
            // An admin may reach any patient that exists; one that does not is a 404 like any other.
            case "ADMIN" -> patients.existsById(patientId);
            case "CAREGIVER" -> patients.existsByIdAndCaregiverId(patientId, principal.userId());
            case "DOCTOR" -> grants.existsLive(patientId, principal.userId(), clock.instant());
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
        boolean read = isReadRequest();
        // One look at a dashboard is several requests; it is recorded once a minute, not once each.
        // Changes are always recorded.
        if (read && audit.recordedWithin(principal.userId(), "PATIENT_READ", patientId, READ_COALESCE)) {
            return;
        }
        audit.record(actor, principal.userId(), read ? "PATIENT_READ" : "PATIENT_WRITE",
                patientId, resource(), ip(), Map.of("capability", capability.name()));
    }

    private void denied(SmaranPrincipal principal, String patientId, Capability capability, String why) {
        audit.record(actorOf(principal.role()), principal.userId(), "ACCESS_DENIED", patientId, resource(), ip(),
                capability == null ? Map.of("why", why) : Map.of("capability", capability.name(), "why", why));
    }

    static Actor actorOf(String role) {
        return switch (role == null ? "" : role) {
            case "ADMIN" -> Actor.ADMIN;
            case "CAREGIVER" -> Actor.CAREGIVER;
            case "DOCTOR" -> Actor.DOCTOR;
            case "DEVICE" -> Actor.DEVICE;
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
