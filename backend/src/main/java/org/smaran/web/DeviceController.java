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
import org.smaran.scoring.Contract;
import org.smaran.domain.Enums.Mood;
import org.smaran.domain.FamilyMember;
import org.smaran.domain.MoodLog;
import org.smaran.domain.Patient;
import org.smaran.domain.ReminderSchedule;
import org.smaran.repo.MeaningfulObjectRepository;
import org.smaran.repo.MoodLogRepository;
import org.smaran.repo.PatientRepository;
import org.smaran.journal.JournalService;
import org.smaran.journal.JournalSignals;
import org.smaran.service.AudioBiomarkerService;
import org.smaran.service.CognitiveAdaptationService;
import org.smaran.service.CognitiveProfileService;
import org.smaran.service.DashboardService;
import org.smaran.service.FamilyGroveAdaptationService;
import org.smaran.service.FederatedAggregationService;
import org.smaran.service.GardenStateService;
import org.smaran.service.ReminderService;
import org.smaran.service.SessionIngestionService;
import org.smaran.service.StorageService;
import org.springframework.core.io.FileSystemResource;
import org.springframework.core.io.Resource;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.codec.ServerSentEvent;
import org.springframework.http.ResponseEntity;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
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
    private final SessionIngestionService ingestion;
    private final AudioBiomarkerService biomarkers;
    private final FederatedAggregationService federated;
    private final FamilyGroveAdaptationService grove;
    private final ReminderService reminders;
    private final MeaningfulObjectRepository objects;
    private final MoodLogRepository moods;
    private final StorageService storage;
    private final CognitiveAdaptationService adaptation;
    private final JournalService journal;

    public DeviceController(
            AccessGuard guard,
            PatientRepository patients,
            CognitiveProfileService profiles,
            GardenStateService gardens,
            DashboardService dashboard,
            SessionIngestionService ingestion,
            AudioBiomarkerService biomarkers,
            FederatedAggregationService federated,
            FamilyGroveAdaptationService grove,
            ReminderService reminders,
            MeaningfulObjectRepository objects,
            MoodLogRepository moods,
            StorageService storage,
            CognitiveAdaptationService adaptation,
            JournalService journal) {
        this.guard = guard;
        this.patients = patients;
        this.profiles = profiles;
        this.gardens = gardens;
        this.dashboard = dashboard;
        this.ingestion = ingestion;
        this.biomarkers = biomarkers;
        this.federated = federated;
        this.grove = grove;
        this.reminders = reminders;
        this.objects = objects;
        this.moods = moods;
        this.storage = storage;
        this.adaptation = adaptation;
        this.journal = journal;
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

    /**
     * Always 200, even for a duplicate: a tablet re-sending a week-old queue on a
     * flaky connection must not get an error it would then retry forever. A
     * session the server will not accept is answered with the reason and not
     * stored; the tablet drops it from its queue, because sending it again would
     * be refused again.
     */
    @PostMapping("/sessions")
    public Dto.BatchResponse submit(@RequestBody Contract.SessionEnvelope body) {
        SmaranPrincipal device = guard.requireDevice();
        return respond(ingestion.ingestBatch(device.patientIds().get(0), device.userId(), List.of(body)));
    }

    /** What a tablet sends after being offline: its queue of finished sessions and voice features. */
    public record SyncBatch(
            List<Contract.SessionEnvelope> sessions, List<Dto.AcousticVectorDto> vectors, List<Dto.WaterRequest> blooms) {
    }

    @PostMapping("/sessions/batch")
    public Dto.BatchResponse batch(@RequestBody SyncBatch body) {
        SmaranPrincipal device = guard.requireDevice();
        String id = device.patientIds().get(0);
        if (body.vectors() != null) {
            body.vectors().forEach(v -> biomarkers.store(ownedBy(id, v)));
        }
        return respond(ingestion.ingestBatch(id, device.userId(), body.sessions()));
    }

    private Dto.BatchResponse respond(SessionIngestionService.BatchResult r) {
        List<Dto.Rejection> rejected = r.outcomes().stream()
                .filter(o -> o.status() == SessionIngestionService.Status.REJECTED)
                .map(o -> new Dto.Rejection(o.clientSessionId(), o.reason()))
                .toList();
        return new Dto.BatchResponse(
                r.count(SessionIngestionService.Status.ACCEPTED),
                r.count(SessionIngestionService.Status.DUPLICATE),
                rejected,
                dashboard.toGardenDto(r.garden()));
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

    private static Dto.AcousticVectorDto ownedBy(String id, Dto.AcousticVectorDto b) {
        return new Dto.AcousticVectorDto(
                id, b.sessionId(), b.capturedAt(), b.jitter(), b.shimmer(), b.pauseDurationAvg(), b.speechRate(),
                b.phonationRatio());
    }

    /* ----------------------------------------------------------- journal */

    public record JournalEntry(String text, Integer localHour) {
    }

    public record JournalReading(JournalSignals signals) {
    }

    /**
     * Her journal entry, read for how it feels. The text is sent for this one request and is
     * never stored; only the signals are. With no model configured the answer is
     * {@code {"signals": null}} and nothing is stored.
     */
    @PostMapping("/journal/analyse")
    public JournalReading analyse(@RequestBody JournalEntry body) {
        SmaranPrincipal device = guard.requireDevice();
        return new JournalReading(
                journal.analyse(device.patientIds().get(0), device.userId(), body.text(), body.localHour()).orElse(null));
    }

    /* ---------------------------------------------------- reactive ease */

    /**
     * One scalar load score and three proxy numbers derived on the tablet from
     * face-mesh geometry. No video, no landmarks and no audio reach this
     * endpoint, which is what makes the privacy claim architectural.
     */
    @PostMapping("/cognitive/sample")
    public void sample(@RequestBody Dto.LoadSample body) {
        adaptation.sample(patientId(), body);
    }

    /** The ease events for a session. Whose session it is is read from the token, not from the id. */
    @GetMapping(value = "/cognitive/stream/{sessionId}", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public reactor.core.publisher.Flux<ServerSentEvent<Dto.DifficultyEaseEvent>> stream(@PathVariable String sessionId) {
        patientId();
        return adaptation.stream(sessionId)
                .map(event -> ServerSentEvent.<Dto.DifficultyEaseEvent>builder()
                        .event(event.loadScore() < 0 ? "heartbeat" : "ease")
                        .data(event)
                        .retry(Duration.ofSeconds(5))
                        .build());
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
