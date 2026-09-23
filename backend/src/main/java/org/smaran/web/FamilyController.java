package org.smaran.web;

import java.util.List;
import org.smaran.config.AccessGuard;
import org.smaran.domain.FamilyMember;
import org.smaran.service.CognitiveProfileService;
import org.smaran.service.FamilyGroveAdaptationService;
import org.smaran.service.StorageService;
import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

/**
 * The grove.
 *
 * Adding a member is multipart because the two fields that matter most — a
 * photograph and five seconds of a familiar voice — are files, and the caregiver
 * is often doing this on a phone in a hospital waiting room with one hand.
 */
@RestController
@RequestMapping("/api/family")
public class FamilyController {

    private final FamilyGroveAdaptationService grove;
    private final CognitiveProfileService profiles;
    private final StorageService storage;
    private final AccessGuard guard;

    public FamilyController(
            FamilyGroveAdaptationService grove,
            CognitiveProfileService profiles,
            StorageService storage,
            AccessGuard guard) {
        this.grove = grove;
        this.profiles = profiles;
        this.storage = storage;
        this.guard = guard;
    }

    @GetMapping("/{patientId}/members")
    public List<Dto.FamilyMemberDto> members(@PathVariable String patientId) {
        guard.requireAccessTo(patientId);
        return grove.forPatient(patientId).stream().map(this::toDto).toList();
    }

    @PostMapping(value = "/{patientId}/member", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public Dto.FamilyMemberDto add(
            @PathVariable String patientId,
            @RequestParam String name,
            @RequestParam(required = false) String relationship,
            @RequestParam(required = false) String kinshipTermLocal,
            @RequestParam(required = false) String contextHint,
            @RequestParam(required = false) MultipartFile photo,
            @RequestParam(required = false) MultipartFile voiceNote) {

        guard.requireAccessTo(patientId);

        FamilyMember member = new FamilyMember();
        member.setPatientId(patientId);
        member.setName(name);
        member.setRelationship(relationship);
        member.setKinshipTermLocal(kinshipTermLocal);
        member.setContextHint(contextHint);
        member.setPhotoS3Key(storage.store(photo, patientId, "face"));
        member.setVoiceNoteS3Key(storage.store(voiceNote, patientId, "voice"));

        // A new face starts where her profile says a new face should start, not
        // at whatever phase the rest of the tree has climbed to.
        int startingPhase = profiles.forPatient(patientId).getStartingPhase();
        return toDto(grove.add(member, startingPhase));
    }

    /**
     * One answer from Family Grove. A correct one advances this member's phase
     * (after three fluent recognitions) and tells them to record a new voice
     * note — which is the content she will hear next time she opens the grove.
     */
    @PostMapping("/{patientId}/member/{memberId}/result")
    public Dto.FamilyMemberDto result(
            @PathVariable String patientId,
            @PathVariable String memberId,
            @RequestBody Dto.RecognitionResult body) {
        guard.requireAccessTo(patientId);
        return toDto(grove.recordResult(patientId, memberId, body.correct(), body.latencyMs()));
    }

    private Dto.FamilyMemberDto toDto(FamilyMember m) {
        return new Dto.FamilyMemberDto(
                m.getId(),
                m.getPatientId(),
                m.getName(),
                m.getRelationship(),
                m.getKinshipTermLocal(),
                storage.urlFor(m.getPhotoS3Key()),
                storage.urlFor(m.getVoiceNoteS3Key()),
                m.getContextHint(),
                m.getCurrentPhase());
    }
}
