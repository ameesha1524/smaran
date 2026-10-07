package org.smaran.web;

import jakarta.servlet.http.HttpServletRequest;
import java.util.List;
import org.smaran.config.AccessGuard;
import org.smaran.config.AccessGuard.Capability;
import org.smaran.config.JwtAuthFilter.SmaranPrincipal;
import org.smaran.domain.AppUser;
import org.smaran.domain.DoctorGrant;
import org.smaran.domain.Patient;
import org.smaran.service.AuditService;
import org.smaran.service.AuthService;
import org.smaran.service.PatientAccessService;
import org.springframework.http.HttpStatus;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/**
 * A caregiver's own patients, who else may see them, and who has looked.
 *
 * Creating a patient needs the guardian's consent. Granting a doctor needs the
 * doctor's email, and the grant carries an expiry. The audit trail is the
 * caregiver's to read for their patients.
 */
@RestController
@RequestMapping("/api/patients")
public class PatientsController {

    private final PatientAccessService access;
    private final AuthService auth;
    private final AuditService audit;
    private final AccessGuard guard;

    public PatientsController(PatientAccessService access, AuthService auth, AuditService audit, AccessGuard guard) {
        this.access = access;
        this.auth = auth;
        this.audit = audit;
        this.guard = guard;
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    @PreAuthorize("@roles.any('CAREGIVER')")
    public Dto.PatientDto create(@RequestBody Dto.CreatePatientRequest body, HttpServletRequest request) {
        AppUser owner = auth.requireUser(guard.currentUserId());
        Patient patient = access.createPatient(owner, body, request.getRemoteAddr());
        return new Dto.PatientDto(
                patient.getId(), patient.getName(), patient.getLanguageCode(), patient.getKinshipTerm(),
                patient.getRegion(), patient.getFaith(), patient.getPeakWindow(), patient.getProfileVersion(),
                patient.getCaregiverId(), null);
    }

    @GetMapping
    @PreAuthorize("@roles.any('CAREGIVER')")
    public List<Dto.PatientDto> mine() {
        return access.ownedBy(guard.currentUserId()).stream()
                .map(p -> new Dto.PatientDto(
                        p.getId(), p.getName(), p.getLanguageCode(), p.getKinshipTerm(), p.getRegion(), p.getFaith(),
                        p.getPeakWindow(), p.getProfileVersion(), p.getCaregiverId(), null))
                .toList();
    }

    /* -------------------------------------------------------------- grants */

    @PostMapping("/{patientId}/doctor-grants")
    @ResponseStatus(HttpStatus.CREATED)
    @PreAuthorize("@roles.any('CAREGIVER', 'ADMIN')")
    public Dto.GrantDto grant(
            @PathVariable String patientId, @RequestBody Dto.GrantRequest body, HttpServletRequest request) {
        SmaranPrincipal who = guard.require(patientId, Capability.CAREGIVE);
        DoctorGrant grant = access.grant(
                patientId, auth.requireUser(who.userId()), body.doctorEmail(), body.days(), request.getRemoteAddr());
        return access.grantsFor(patientId).stream().filter(g -> g.id().equals(grant.getId())).findFirst().orElseThrow();
    }

    @GetMapping("/{patientId}/doctor-grants")
    @PreAuthorize("@roles.any('CAREGIVER', 'ADMIN')")
    public List<Dto.GrantDto> grants(@PathVariable String patientId) {
        guard.require(patientId, Capability.CAREGIVE);
        return access.grantsFor(patientId);
    }

    @DeleteMapping("/{patientId}/doctor-grants/{grantId}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    @PreAuthorize("@roles.any('CAREGIVER', 'ADMIN')")
    public void revoke(@PathVariable String patientId, @PathVariable String grantId, HttpServletRequest request) {
        SmaranPrincipal who = guard.require(patientId, Capability.CAREGIVE);
        access.revoke(patientId, grantId, auth.requireUser(who.userId()), request.getRemoteAddr());
    }

    /* --------------------------------------------------------------- audit */

    @GetMapping("/{patientId}/audit")
    @PreAuthorize("@roles.any('CAREGIVER', 'ADMIN')")
    public List<AuditService.Event> audit(@PathVariable String patientId, @RequestParam(defaultValue = "100") int limit) {
        guard.require(patientId, Capability.CAREGIVE);
        return audit.forPatient(patientId, limit);
    }
}
