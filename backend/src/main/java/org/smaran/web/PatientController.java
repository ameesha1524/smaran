package org.smaran.web;

import java.time.ZoneId;
import java.time.Instant;
import java.util.List;
import org.smaran.config.AccessGuard;
import org.smaran.domain.CognitiveProfile;
import org.smaran.domain.MeaningfulObject;
import org.smaran.domain.MoodLog;
import org.smaran.domain.Patient;
import org.smaran.repo.MeaningfulObjectRepository;
import org.smaran.repo.MoodLogRepository;
import org.smaran.repo.PatientRepository;
import org.smaran.service.CognitiveProfileService;
import org.smaran.service.StorageService;
import org.springframework.http.HttpStatus;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

/**
 * The patient record, her object library, and her mood check-ins.
 *
 * Note that the mood endpoint records the *local* hour alongside the instant.
 * Sundowning is a fact about her afternoon, and a server in another time zone
 * must not be able to erase it.
 */
@RestController
@RequestMapping("/api/patient")
public class PatientController {

    private final PatientRepository patients;
    private final MeaningfulObjectRepository objects;
    private final MoodLogRepository moods;
    private final CognitiveProfileService profiles;
    private final StorageService storage;
    private final AccessGuard guard;

    public PatientController(
            PatientRepository patients,
            MeaningfulObjectRepository objects,
            MoodLogRepository moods,
            CognitiveProfileService profiles,
            StorageService storage,
            AccessGuard guard) {
        this.patients = patients;
        this.objects = objects;
        this.moods = moods;
        this.profiles = profiles;
        this.storage = storage;
        this.guard = guard;
    }

    @GetMapping("/{id}/profile")
    public Dto.PatientDto profile(@PathVariable String id) {
        guard.requireAccessTo(id);
        Patient patient = patients.findById(id)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND));
        CognitiveProfile profile = profiles.forPatient(id);
        return toDto(patient, profile);
    }

    @PatchMapping("/{id}/profile")
    @Transactional
    public Dto.PatientDto update(@PathVariable String id, @RequestBody Dto.PatientPatch patch) {
        guard.requireAccessTo(id);
        Patient patient = patients.findById(id)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND));

        if (patch.name() != null) {
            patient.setName(patch.name());
        }
        if (patch.languageCode() != null) {
            patient.setLanguageCode(patch.languageCode());
        }
        if (patch.kinshipTerm() != null) {
            patient.setKinshipTerm(patch.kinshipTerm());
        }
        if (patch.region() != null) {
            patient.setRegion(patch.region());
        }
        if (patch.faith() != null) {
            patient.setFaith(patch.faith());
        }
        if (patch.peakWindow() != null) {
            patient.setPeakWindow(patch.peakWindow());
            CognitiveProfile profile = profiles.forPatient(id);
            profile.setSelfReportedPeak(patch.peakWindow());
        }
        if (patch.profileVersion() != null) {
            patient.setProfileVersion(patch.profileVersion());
        }

        patients.save(patient);
        return toDto(patient, profiles.forPatient(id));
    }

    /* ----------------------------------------------------- object library */

    @GetMapping("/{id}/objects")
    public List<ObjectDto> listObjects(@PathVariable String id) {
        guard.requireAccessTo(id);
        return objects.findByPatientId(id).stream().map(this::toObjectDto).toList();
    }

    @PutMapping("/{id}/objects")
    @Transactional
    public List<ObjectDto> replaceObjects(@PathVariable String id, @RequestBody List<ObjectDto> body) {
        guard.requireAccessTo(id);
        objects.deleteByPatientId(id);
        List<MeaningfulObject> saved = objects.saveAll(body.stream()
                .map(dto -> {
                    MeaningfulObject o = new MeaningfulObject();
                    o.setPatientId(id);
                    o.setName(dto.name());
                    o.setSemanticCluster(dto.semanticCluster());
                    o.setGlyph(dto.glyph());
                    return o;
                })
                .toList());
        return saved.stream().map(this::toObjectDto).toList();
    }

    /* --------------------------------------------------------- check-in */

    @PostMapping("/{id}/mood")
    @Transactional
    public void checkIn(@PathVariable String id, @RequestBody Dto.MoodCheckIn body) {
        guard.requireAccessTo(id);
        MoodLog log = new MoodLog();
        log.setPatientId(id);
        log.setMood(body.mood());
        log.setAt(Instant.now());
        log.setLocalHour(body.localHour() != null
                ? body.localHour()
                : Instant.now().atZone(ZoneId.systemDefault()).getHour());
        moods.save(log);
    }

    /* --------------------------------------------------------- mapping */

    private Dto.PatientDto toDto(Patient p, CognitiveProfile profile) {
        return new Dto.PatientDto(
                p.getId(),
                p.getName(),
                p.getLanguageCode(),
                p.getKinshipTerm(),
                p.getRegion(),
                p.getFaith(),
                p.getPeakWindow(),
                p.getProfileVersion(),
                p.getCaregiverId(),
                profiles.toDto(profile));
    }

    private ObjectDto toObjectDto(MeaningfulObject o) {
        return new ObjectDto(
                o.getId(),
                o.getPatientId(),
                o.getName(),
                o.getSemanticCluster(),
                storage.urlFor(o.getImageS3Key()),
                o.getGlyph());
    }

    public record ObjectDto(
            String id,
            String patientId,
            String name,
            org.smaran.domain.Enums.SemanticCluster semanticCluster,
            String imageUrl,
            String glyph) {
    }
}
