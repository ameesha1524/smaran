package org.smaran.web;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneId;
import java.util.List;
import org.smaran.config.AccessGuard;
import org.smaran.config.JwtAuthFilter.SmaranPrincipal;
import org.smaran.domain.Enums.Mood;
import org.smaran.domain.FamilyMember;
import org.smaran.domain.MoodLog;
import org.smaran.domain.Patient;
import org.smaran.domain.ReminderSchedule;
import org.smaran.repo.MeaningfulObjectRepository;
import org.smaran.repo.MoodLogRepository;
import org.smaran.repo.PatientRepository;
import org.smaran.service.AudioBiomarkerService;
import org.smaran.service.CognitiveProfileService;
import org.smaran.service.DashboardService;
import org.smaran.service.FamilyGroveAdaptationService;
import org.smaran.service.FederatedAggregationService;
import org.smaran.service.GardenStateService;
import org.smaran.service.ReminderService;
import org.smaran.service.SessionService;
import org.smaran.service.StorageService;
import org.smaran.service.SyncService;
import org.springframework.core.io.FileSystemResource;
import org.springframework.core.io.Resource;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.web.servlet.HandlerMapping;
import jakarta.servlet.http.HttpServletRequest;

/**
 * Everything a paired tablet may do, and nothing else.
 *
 * <p>No path here carries a patient id. The patient is whichever one the
 * tablet's token was paired to, read from the token by
 * {@link AccessGuard#requireDevice()}. A tablet therefore has no id to get
 * wrong, and no way to ask about anyone else; and what it sends in a body is
 * overwritten with its own patient before it reaches a service.
 *
 * <p>The other direction is closed too: a device token is refused by every
 * caregiver, doctor and admin endpoint (see the Appendix B matrix test).
 */
@RestController
@RequestMapping("/api/device")
public class DeviceController {

    private final AccessGuard guard;
    private final PatientRepository patients;
    private final CognitiveProfileService profiles;
    private final GardenStateService gardens;
    private final DashboardService dashboard;
    private final SessionService sessions;
    private final SyncService sync;
    private final AudioBiomarkerService biomarkers;
    private final FederatedAggregationService federated;
    private final FamilyGroveAdaptationService grove;
    private final ReminderService reminders;
    private final MeaningfulObjectRepository objects;
    private final MoodLogRepository moods;
    private final StorageService storage;

    public DeviceController(
            AccessGuard guard,
            PatientRepository patients,
            CognitiveProfileService profiles,
            GardenStateService gardens,
            DashboardService dashboard,
            SessionService sessions,
            SyncService sync,
            AudioBiomarkerService biomarkers,
            FederatedAggregationService federated,
            FamilyGroveAdaptationService grove,
            ReminderService reminders,
            MeaningfulObjectRepository objects,
            MoodLogRepository moods,
            StorageService storage) {
        this.guard = guard;
        this.patients = patients;
        this.profiles = profiles;
        this.gardens = gardens;
        this.dashboard = dashboard;
        this.sessions = sessions;
        this.sync = sync;
        this.biomarkers = biomarkers;
        this.federated = federated;
        this.grove = grove;
        this.reminders = reminders;
        this.objects = objects;
        this.moods = moods;
        this.storage = storage;
    }

    /** The patient this tablet is paired to. The only way any method here learns who she is. */
    private String patientId() {
        SmaranPrincipal device = guard.requireDevice();
        return device.patientIds().get(0);
    }

    /* ------------------------------------------------------------- her */

    public static Dto.DeviceBundle bundleOf(Patient p) {
        return new Dto.DeviceBundle(p.getId(), firstNameOf(p.getName()), p.getLanguageCode(), p.getKinshipTerm());
    }

    static String firstNameOf(String fullName) {
        if (fullName == null || fullName.isBlank()) {
            return "";
        }
        return fullName.strip().split("\\s+")[0];
    }

    @GetMapping("/me")
    public Dto.DeviceMe me() {
        String id = patientId();
        return meOf(patient(id));
    }

    /** The one thing a tablet may change: the language she confirms she is greeted in. */
    @PatchMapping("/me")
    @Transactional
    public Dto.DeviceMe update(@RequestBody Dto.DeviceMePatch patch) {
        String id = patientId();
        Patient p = patient(id);
        if (patch.languageCode() != null) {
            if (!patch.languageCode().matches("[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})?")) {
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "That is not a language code.");
            }
            p.setLanguageCode(patch.languageCode());
            patients.save(p);
        }
        return meOf(p);
    }

    private Dto.DeviceMe meOf(Patient p) {
        return new Dto.DeviceMe(
                p.getId(),
                firstNameOf(p.getName()),
                p.getLanguageCode(),
                p.getKinshipTerm(),
                p.getRegion(),
                p.getPeakWindow(),
                p.getProfileVersion(),
                profiles.toDto(profiles.forPatient(p.getId())));
    }

    private Patient patient(String id) {
        return patients.findById(id).orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND));
    }

    @GetMapping("/game/route")
    public Dto.GameRouteDto route(@RequestParam(required = false) Mood mood) {
        return profiles.deriveGameRoute(patientId(), mood);
    }

    /* ---------------------------------------------------------- garden */

    @GetMapping("/garden")
    public Dto.GardenDto garden() {
        return dashboard.toGardenDto(gardens.forPatient(patientId()));
    }

    @PostMapping("/garden/water")
    public Dto.GardenDto water(@RequestBody Dto.WaterRequest body) {
        String id = patientId();
        double completion = body.completionRate() == null ? 1.0 : body.completionRate();
        return dashboard.toGardenDto(gardens.computeGrowth(id, body.gameType(), completion));
    }

    /* -------------------------------------------------------- sessions */

    public record SessionAck(String id, boolean duplicate) {
    }

    /**
     * Always 200, even for a duplicate: a tablet re-sending a week-old queue on a
     * flaky connection must not get an error it would then retry forever.
     */
    @PostMapping("/sessions")
    public SessionAck submit(
            @RequestBody Dto.SessionSubmission body,
            @RequestHeader(value = "X-Smaran-Session", required = false) String sessionKey) {
        String id = patientId();
        Dto.SessionSubmission mine = ownedBy(id, body);
        if (mine.startedAt() == null || mine.gameType() == null) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "A session needs a game and a start time.");
        }
        SessionService.Accepted accepted = sessions.submit(mine, sessionKey);
        return new SessionAck(accepted.session().getId(), accepted.duplicate());
    }

    /** What a tablet sends after being offline: its queue of sessions, voice features and waterings. */
    public record SyncBatch(
            List<Dto.SessionSubmission> sessions, List<Dto.AcousticVectorDto> vectors, List<Dto.WaterRequest> blooms) {
    }

    @PostMapping("/sessions/batch")
    public Dto.SyncResponse batch(@RequestBody SyncBatch body) {
        String id = patientId();
        List<Dto.SessionSubmission> mine = body.sessions() == null
                ? List.of()
                : body.sessions().stream().map(s -> ownedBy(id, s)).toList();
        List<Dto.AcousticVectorDto> vectors = body.vectors() == null
                ? List.of()
                : body.vectors().stream().map(v -> ownedBy(id, v)).toList();
        return sync.merge(new Dto.SyncRequest(id, mine, vectors, body.blooms()));
    }

    @PostMapping("/biomarker/vector")
    public void vector(@RequestBody Dto.AcousticVectorDto body) {
        biomarkers.store(ownedBy(patientId(), body));
    }

    @PostMapping("/fl/gradients")
    public Dto.GlobalModel gradients(@RequestBody Dto.GradientUpload body) {
        String id = patientId();
        return federated.receive(new Dto.GradientUpload(body.deviceId(), id, body.modelVersion(), body.cipher()));
    }

    /** Whatever patient a tablet's body names, it is hers. */
    private static Dto.SessionSubmission ownedBy(String id, Dto.SessionSubmission b) {
        return new Dto.SessionSubmission(
                id, b.gameType(), b.startedAt(), b.durationMs(), b.completionRate(), b.difficultyTier(),
                b.cognitiveLoadScore(), b.moodAtStart(), b.objectResults(), b.domainReadings(), b.metrics());
    }

    private static Dto.AcousticVectorDto ownedBy(String id, Dto.AcousticVectorDto b) {
        return new Dto.AcousticVectorDto(
                id, b.sessionId(), b.capturedAt(), b.jitter(), b.shimmer(), b.pauseDurationAvg(), b.speechRate(),
                b.phonationRatio());
    }

    /* ---------------------------------------------------------- check-in */

    public record DeviceMood(Mood mood, Integer localHour) {
    }

    @PostMapping("/mood")
    @Transactional
    public void checkIn(@RequestBody DeviceMood body) {
        MoodLog log = new MoodLog();
        log.setPatientId(patientId());
        log.setMood(body.mood());
        log.setAt(Instant.now());
        log.setLocalHour(body.localHour() != null
                ? body.localHour()
                : Instant.now().atZone(ZoneId.systemDefault()).getHour());
        moods.save(log);
    }

    /* -------------------------------------------------------- her things */

    @GetMapping("/objects")
    public List<PatientController.ObjectDto> objects() {
        return objects.findByPatientId(patientId()).stream()
                .map(o -> new PatientController.ObjectDto(
                        o.getId(), o.getPatientId(), o.getName(), o.getSemanticCluster(),
                        deviceUrl(storage.urlFor(o.getImageS3Key())), o.getGlyph()))
                .toList();
    }

    @GetMapping("/family/members")
    public List<Dto.FamilyMemberDto> members() {
        return grove.forPatient(patientId()).stream().map(this::memberDto).toList();
    }

    @PostMapping("/family/members/{memberId}/result")
    public Dto.FamilyMemberDto recognised(@PathVariable String memberId, @RequestBody Dto.RecognitionResult body) {
        return memberDto(grove.recordResult(patientId(), memberId, body.correct(), body.latencyMs()));
    }

    @GetMapping("/reminders")
    public List<Dto.ReminderDto> reminders() {
        return reminders.forPatient(patientId()).stream().map(DeviceController::reminderDto).toList();
    }

    private Dto.FamilyMemberDto memberDto(FamilyMember m) {
        return new Dto.FamilyMemberDto(
                m.getId(),
                m.getPatientId(),
                m.getName(),
                m.getRelationship(),
                m.getKinshipTermLocal(),
                deviceUrl(storage.urlFor(m.getPhotoS3Key())),
                deviceUrl(storage.urlFor(m.getVoiceNoteS3Key())),
                m.getContextHint(),
                m.getCurrentPhase());
    }

    private static Dto.ReminderDto reminderDto(ReminderSchedule r) {
        return new Dto.ReminderDto(
                r.getId(), r.getPatientId(), r.getType().name(), r.getScheduledTime(), r.getPhotoS3Key(),
                r.getMessageTemplate(), r.getLanguageCode());
    }

    /** Media a tablet is told about is fetched from its own path, which only ever serves her files. */
    private static String deviceUrl(String url) {
        return url == null ? null : url.replaceFirst("^/api/media/", "/api/device/media/");
    }

    /**
     * Her photographs and voice notes. The first segment of a stored key is the
     * patient id, so a tablet can fetch a file only if the key starts with hers.
     */
    @GetMapping("/media/**")
    public ResponseEntity<Resource> media(HttpServletRequest request) throws IOException {
        String id = patientId();
        String full = (String) request.getAttribute(HandlerMapping.PATH_WITHIN_HANDLER_MAPPING_ATTRIBUTE);
        String key = full == null ? "" : full.replaceFirst("^/api/device/media/", "");
        if (key.isBlank() || key.contains("..") || !key.startsWith(id + "/")) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND);
        }
        Path path = storage.resolve(key);
        if (path == null || !Files.isReadable(path)) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND);
        }
        String contentType = Files.probeContentType(path);
        return ResponseEntity.ok()
                .contentType(contentType == null
                        ? MediaType.APPLICATION_OCTET_STREAM
                        : MediaType.parseMediaType(contentType))
                .cacheControl(CacheControl.maxAge(Duration.ofDays(30)).cachePrivate())
                .body(new FileSystemResource(path));
    }
}
