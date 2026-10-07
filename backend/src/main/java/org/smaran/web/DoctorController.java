package org.smaran.web;

import java.util.List;
import org.smaran.config.AccessGuard;
import org.smaran.service.PatientAccessService;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * What a doctor can open: the patients shared with them, and until when.
 * From there the dashboard and the report are the same read-only endpoints a
 * caregiver uses, gated by the grant.
 */
@RestController
@RequestMapping("/api/doctor")
public class DoctorController {

    private final PatientAccessService access;
    private final AccessGuard guard;

    public DoctorController(PatientAccessService access, AccessGuard guard) {
        this.access = access;
        this.guard = guard;
    }

    @GetMapping("/patients")
    @PreAuthorize("@roles.any('DOCTOR')")
    public List<Dto.DoctorPatientDto> patients() {
        return access.patientsSharedWith(guard.currentUserId());
    }
}
