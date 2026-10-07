package org.smaran.service;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import org.smaran.domain.AppUser;
import org.smaran.domain.AppUser.Status;
import org.smaran.domain.ConsentRecord;
import org.smaran.domain.DoctorGrant;
import org.smaran.domain.Enums.PeakWindow;
import org.smaran.domain.Enums.Role;
import org.smaran.domain.Patient;
import org.smaran.repo.AppUserRepository;
import org.smaran.repo.ConsentRecordRepository;
import org.smaran.repo.DoctorGrantRepository;
import org.smaran.repo.PatientRepository;
import org.smaran.service.AuditService.Actor;
import org.smaran.web.Dto;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

/**
 * Creating a patient, and deciding who else may see her.
 *
 * A patient is created by a caregiver, who owns her from that moment, and only
 * with the guardian's consent recorded: which notice, by whom, when. Nothing
 * about her is collected before that row exists.
 *
 * A doctor sees a patient only through a grant the owner gives, with an expiry
 * the owner chooses (at most a year) and can end at any time. Granting again
 * to the same doctor replaces the earlier grant rather than stacking another.
 */
@Service
@Transactional
public class PatientAccessService {

    /** The version of the consent notice shown today. Kept in the record so a later change is visible. */
    public static final String CURRENT_NOTICE = "2026-10";

    static final int DEFAULT_GRANT_DAYS = 90;
    static final int MAX_GRANT_DAYS = 365;

    private final PatientRepository patients;
    private final ConsentRecordRepository consents;
    private final DoctorGrantRepository grants;
    private final AppUserRepository users;
    private final AuditService audit;
    private final Clock clock;

    public PatientAccessService(
            PatientRepository patients,
            ConsentRecordRepository consents,
            DoctorGrantRepository grants,
            AppUserRepository users,
            AuditService audit,
            Clock clock) {
        this.patients = patients;
        this.consents = consents;
        this.grants = grants;
        this.users = users;
        this.audit = audit;
        this.clock = clock;
    }

    /* ------------------------------------------------------------ patients */

    public Patient createPatient(AppUser owner, Dto.CreatePatientRequest body, String ip) {
        if (!body.guardianConsent()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                    "The guardian's consent is needed before anything is recorded about her.");
        }
        String name = body.name() == null ? "" : body.name().trim();
        if (name.isEmpty() || name.length() > 200) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Enter her name.");
        }

        Patient patient = new Patient();
        patient.setName(name);
        patient.setCaregiverId(owner.getId());
        if (body.languageCode() != null && !body.languageCode().isBlank()) {
            patient.setLanguageCode(body.languageCode().trim());
        }
        patient.setKinshipTerm(body.kinshipTerm() == null ? "" : body.kinshipTerm().trim());
        patient.setRegion(blankToNull(body.region()));
        patient.setFaith(blankToNull(body.faith()));
        patient.setPeakWindow(body.peakWindow() == null ? PeakWindow.MORNING : body.peakWindow());
        patient = patients.save(patient);

        ConsentRecord consent = new ConsentRecord();
        consent.setPatientId(patient.getId());
        consent.setGivenBy(owner.getId());
        consent.setNoticeVersion(blankToNull(body.noticeVersion()) != null ? body.noticeVersion().trim() : CURRENT_NOTICE);
        consent.setGuardianName(blankToNull(body.guardianName()));
        consents.save(consent);

        audit.record(Actor.CAREGIVER, owner.getId(), "PATIENT_CREATED", patient.getId(), null, ip,
                Map.of("noticeVersion", consent.getNoticeVersion()));
        return patient;
    }

    public List<Patient> ownedBy(String userId) {
        return patients.findByCaregiverId(userId);
    }

    /* -------------------------------------------------------------- grants */

    public DoctorGrant grant(String patientId, AppUser grantedBy, String doctorEmail, Integer days, String ip) {
        int lifetime = days == null ? DEFAULT_GRANT_DAYS : days;
        if (lifetime < 1 || lifetime > MAX_GRANT_DAYS) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                    "Choose between 1 and " + MAX_GRANT_DAYS + " days.");
        }
        AppUser doctor = users.findByEmail(doctorEmail == null ? "" : doctorEmail.trim().toLowerCase())
                .filter(u -> u.getRole() == Role.DOCTOR && u.getStatus() == Status.ACTIVE)
                .orElseThrow(() -> new ResponseStatusException(
                        HttpStatus.NOT_FOUND, "There is no approved doctor with that email."));

        Instant now = clock.instant();
        grants.revokeOpen(patientId, doctor.getId(), now);
        DoctorGrant grant = new DoctorGrant();
        grant.setPatientId(patientId);
        grant.setDoctorUserId(doctor.getId());
        grant.setGrantedBy(grantedBy.getId());
        grant.setGrantedAt(now);
        grant.setExpiresAt(now.plus(Duration.ofDays(lifetime)));
        grant = grants.save(grant);

        audit.record(actorOf(grantedBy), grantedBy.getId(), "GRANT_CREATED", patientId, null, ip,
                Map.of("doctorId", doctor.getId(), "expiresAt", grant.getExpiresAt().toString()));
        return grant;
    }

    public void revoke(String patientId, String grantId, AppUser by, String ip) {
        DoctorGrant grant = grants.findById(grantId)
                .filter(g -> g.getPatientId().equals(patientId))
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND));
        if (grant.getRevokedAt() == null) {
            grant.setRevokedAt(clock.instant());
            grants.save(grant);
            audit.record(actorOf(by), by.getId(), "GRANT_REVOKED", patientId, null, ip,
                    Map.of("doctorId", grant.getDoctorUserId()));
        }
    }

    @Transactional(readOnly = true)
    public List<Dto.GrantDto> grantsFor(String patientId) {
        Instant now = clock.instant();
        return grants.findByPatientIdOrderByGrantedAtDesc(patientId).stream()
                .map(g -> {
                    Optional<AppUser> doctor = users.findById(g.getDoctorUserId());
                    return new Dto.GrantDto(
                            g.getId(), g.getPatientId(), g.getDoctorUserId(),
                            doctor.map(AppUser::getName).orElse(null), doctor.map(AppUser::getEmail).orElse(null),
                            g.getGrantedAt(), g.getExpiresAt(), g.getRevokedAt(), g.isLiveAt(now));
                })
                .toList();
    }

    /** The patients a doctor has been given right now, with when each share ends. */
    @Transactional(readOnly = true)
    public List<Dto.DoctorPatientDto> patientsSharedWith(String doctorId) {
        return grants.findLiveForDoctor(doctorId, clock.instant()).stream()
                .map(g -> patients.findById(g.getPatientId())
                        .map(p -> new Dto.DoctorPatientDto(p.getId(), p.getName(), g.getExpiresAt())))
                .flatMap(Optional::stream)
                .toList();
    }

    /* ------------------------------------------------------------- helpers */

    private static String blankToNull(String s) {
        return s == null || s.isBlank() ? null : s.trim();
    }

    private static Actor actorOf(AppUser user) {
        return user.getRole() == Role.ADMIN ? Actor.ADMIN : Actor.CAREGIVER;
    }
}
