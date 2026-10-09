package org.smaran.web;

import jakarta.servlet.http.HttpServletRequest;
import java.util.List;
import org.smaran.config.AccessGuard;
import org.smaran.config.AccessGuard.Capability;
import org.smaran.domain.CognitiveProfile;
import org.smaran.domain.Patient;
import org.smaran.repo.PatientRepository;
import org.smaran.service.CognitiveProfileService;
import org.smaran.service.PairingService;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

/**
 * Pairing a tablet — the endpoints from docs/rbac-architecture.md §6.
 *
 * The family side (issue a code, list and remove tablets) needs the CAREGIVE
 * capability on the patient: their owner, or an admin. A doctor can see
 * a patient but cannot put a device in her hands, and a patient's own tablet
 * certainly cannot mint codes for more tablets.
 *
 * The tablet side (redeem) is unauthenticated by necessity; the code is the
 * credential, and PairingService single-uses and rate-limits it.
 */
@RestController
@RequestMapping("/api")
public class PairingController {

    private final PairingService pairing;
    private final PatientRepository patients;
    private final CognitiveProfileService profiles;
    private final AccessGuard guard;

    public PairingController(
            PairingService pairing,
            PatientRepository patients,
            CognitiveProfileService profiles,
            AccessGuard guard) {
        this.pairing = pairing;
        this.patients = patients;
        this.profiles = profiles;
        this.guard = guard;
    }

    @PostMapping("/patients/{patientId}/pairing-codes")
    public Dto.PairingCodeDto issue(@PathVariable String patientId) {
        String actor = requireMayPair(patientId);
        PairingService.IssuedCode code = pairing.issueCode(patientId, actor);
        return new Dto.PairingCodeDto(code.code(), code.expiresAt());
    }

    @GetMapping("/patients/{patientId}/devices")
    public List<Dto.DeviceDto> devices(@PathVariable String patientId) {
        requireMayPair(patientId);
        return pairing.devices(patientId).stream()
                .map(d -> new Dto.DeviceDto(
                        d.getId(), d.getDeviceLabel(), d.getRedeemedAt(), d.getLastSeenAt(), d.getTokenExpiresAt()))
                .toList();
    }

    @DeleteMapping("/patients/{patientId}/devices/{deviceId}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void revoke(@PathVariable String patientId, @PathVariable String deviceId) {
        requireMayPair(patientId);
        pairing.revoke(patientId, deviceId);
    }

    @PostMapping("/devices/redeem")
    public Dto.RedeemResponse redeem(@RequestBody Dto.RedeemRequest body, HttpServletRequest request) {
        PairingService.Redemption r = pairing.redeem(body.code(), body.deviceLabel(), request.getRemoteAddr());

        // The tablet takes on her record and profile in the same response, so
        // it opens straight into her pond without a second round trip.
        Patient patient = patients.findById(r.patientId())
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND));
        CognitiveProfile profile = profiles.forPatient(r.patientId());
        Dto.PatientDto dto = new Dto.PatientDto(
                patient.getId(),
                patient.getName(),
                patient.getLanguageCode(),
                patient.getKinshipTerm(),
                patient.getRegion(),
                patient.getFaith(),
                patient.getPeakWindow(),
                patient.getProfileVersion(),
                patient.getCaregiverId(),
                profiles.toDto(profile));
        return new Dto.RedeemResponse(r.deviceToken(), r.deviceId(), r.patientId(), r.expiresAt(), dto);
    }

    /**
     * Pairing is a caregiving act: the owner or an admin, never a doctor and never
     * a tablet. The guard answers 403 for the wrong kind of user and 404 for a
     * patient that is not theirs.
     */
    private String requireMayPair(String patientId) {
        return guard.require(patientId, Capability.CAREGIVE).userId();
    }
}
