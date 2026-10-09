package org.smaran.web;

import jakarta.servlet.http.HttpServletRequest;
import java.util.List;
import org.smaran.config.AccessGuard;
import org.smaran.config.AccessGuard.Capability;
import org.smaran.domain.Patient;
import org.smaran.repo.PatientRepository;
import org.smaran.service.DeviceService;
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
 * Pairing a tablet.
 *
 * The family side (mint a code, list and remove tablets) needs the CAREGIVE
 * capability on the patient: their owner, or an admin. A doctor can read a
 * patient but cannot put a device in her hands, and a tablet cannot mint codes
 * for more tablets.
 *
 * The tablet side (redeem) is unauthenticated by necessity: the code is the
 * credential, and PairingService single-uses and rate-limits it.
 *
 * The family-side paths stay under {@code /api/patients/{id}} with the rest of
 * a patient's access controls; the prompt's {@code /api/caregiver/patients}
 * spelling would fall under the dashboard's URL rule, which doctors also pass.
 */
@RestController
@RequestMapping("/api")
public class PairingController {

    private final PairingService pairing;
    private final DeviceService devices;
    private final PatientRepository patients;
    private final AccessGuard guard;

    public PairingController(
            PairingService pairing, DeviceService devices, PatientRepository patients, AccessGuard guard) {
        this.pairing = pairing;
        this.devices = devices;
        this.patients = patients;
        this.guard = guard;
    }

    @PostMapping("/patients/{patientId}/pairing-codes")
    public Dto.PairingCodeDto issue(@PathVariable String patientId) {
        String actor = guard.require(patientId, Capability.CAREGIVE).userId();
        // The dev-only open demo has no accounts, and a code's author is a foreign key to one.
        PairingService.IssuedCode code = pairing.issueCode(patientId, guard.isOpenDemo() ? null : actor);
        return new Dto.PairingCodeDto(code.code(), code.expiresAt());
    }

    @GetMapping("/patients/{patientId}/devices")
    public List<Dto.DeviceDto> devices(@PathVariable String patientId) {
        guard.require(patientId, Capability.CAREGIVE);
        return devices.forPatient(patientId).stream()
                .map(d -> new Dto.DeviceDto(d.getId(), d.getLabel(), d.getPairedAt(), d.getLastSeenAt(), d.getExpiresAt()))
                .toList();
    }

    /** Removes the tablet's way in. None of her information is deleted. */
    @DeleteMapping("/patients/{patientId}/devices/{deviceId}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void revoke(@PathVariable String patientId, @PathVariable String deviceId) {
        String actor = guard.require(patientId, Capability.CAREGIVE).userId();
        devices.revoke(patientId, deviceId, actor);
    }

    @PostMapping("/pairing/redeem")
    public Dto.RedeemResponse redeem(@RequestBody Dto.RedeemRequest body, HttpServletRequest request) {
        PairingService.Redemption r =
                pairing.redeem(body.code(), body.deviceLabel(), body.deviceFingerprint(), request.getRemoteAddr());
        Patient patient = patients.findById(r.patientId())
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND));
        return new Dto.RedeemResponse(r.deviceToken(), r.deviceId(), DeviceController.bundleOf(patient));
    }
}
