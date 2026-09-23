package org.smaran.web;

import io.jsonwebtoken.Claims;
import java.util.List;
import org.smaran.config.JwtService;
import org.smaran.domain.Caregiver;
import org.smaran.repo.CaregiverRepository;
import org.springframework.http.HttpStatus;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

/**
 * Login and refresh.
 *
 * The failure message is identical for an unknown email and a wrong password,
 * and both take the same time, because the set of people caring for a dementia
 * patient in a small district is itself sensitive information.
 */
@RestController
@RequestMapping("/api/auth")
public class AuthController {

    private final CaregiverRepository caregivers;
    private final PasswordEncoder encoder;
    private final JwtService jwt;

    public AuthController(CaregiverRepository caregivers, PasswordEncoder encoder, JwtService jwt) {
        this.caregivers = caregivers;
        this.encoder = encoder;
        this.jwt = jwt;
    }

    @PostMapping("/login")
    public Dto.LoginResponse login(@RequestBody Dto.LoginRequest body) {
        Caregiver caregiver = caregivers.findByEmailIgnoreCase(body.email()).orElse(null);

        // Always run a hash comparison, even with no user, so the two paths
        // cannot be told apart by how long they take.
        String hash = caregiver != null ? caregiver.getPasswordHash() : "$2a$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidinv";
        boolean ok = encoder.matches(body.password() == null ? "" : body.password(), hash);

        if (caregiver == null || !ok) {
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Those details did not match.");
        }

        List<String> patientIds = List.copyOf(caregiver.getAssignedPatientIds());
        return new Dto.LoginResponse(
                jwt.issueAccess(caregiver.getId(), caregiver.getRole().name(), patientIds),
                jwt.issueRefresh(caregiver.getId()),
                caregiver.getRole().name(),
                caregiver.getId(),
                patientIds);
    }

    @PostMapping("/refresh")
    public Dto.LoginResponse refresh(@RequestBody Dto.RefreshRequest body) {
        Claims claims = jwt.parse(body.refreshToken());
        if (claims == null || !jwt.isRefresh(claims)) {
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED);
        }
        Caregiver caregiver = caregivers.findById(claims.getSubject())
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.UNAUTHORIZED));

        List<String> patientIds = List.copyOf(caregiver.getAssignedPatientIds());
        return new Dto.LoginResponse(
                jwt.issueAccess(caregiver.getId(), caregiver.getRole().name(), patientIds),
                jwt.issueRefresh(caregiver.getId()),
                caregiver.getRole().name(),
                caregiver.getId(),
                patientIds);
    }
}
