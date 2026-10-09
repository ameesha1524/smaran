package org.smaran.web;

import java.util.List;
import org.smaran.config.AccessGuard;
import org.smaran.config.AccessGuard.Capability;
import org.smaran.config.JwtAuthFilter.SmaranPrincipal;
import org.smaran.domain.ReminderSchedule;
import org.smaran.service.AlertService;
import org.smaran.service.AudioBiomarkerService;
import org.smaran.service.DashboardEvents;
import org.smaran.service.DashboardService;
import org.smaran.service.ReminderService;
import org.smaran.service.ReportService;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

/**
 * Everything the family and the doctor read: the dashboard, the trend, the
 * sessions, the alerts, the PDF, the voice trend and, live, the stream that
 * tells a dashboard something changed.
 *
 * A doctor reads all of it and changes none of it (the guard allows a doctor
 * CLINICAL_READ on GET only). The dashboard a doctor gets is the same view
 * without the family members around her. Raw trials and journal text are not
 * served to anyone: they are stored, and nothing here reads them.
 */
@RestController
@RequestMapping("/api")
public class CaregiverController {

    private final DashboardService dashboard;
    private final ReportService reports;
    private final ReminderService reminders;
    private final AudioBiomarkerService biomarkers;
    private final AlertService alerts;
    private final DashboardEvents events;
    private final AccessGuard guard;

    public CaregiverController(
            DashboardService dashboard,
            ReportService reports,
            ReminderService reminders,
            AudioBiomarkerService biomarkers,
            AlertService alerts,
            DashboardEvents events,
            AccessGuard guard) {
        this.dashboard = dashboard;
        this.reports = reports;
        this.reminders = reminders;
        this.biomarkers = biomarkers;
        this.alerts = alerts;
        this.events = events;
        this.guard = guard;
    }

    @GetMapping("/caregiver/dashboard/{patientId}")
    public Dto.DashboardView summary(@PathVariable String patientId) {
        SmaranPrincipal who = guard.require(patientId, Capability.CLINICAL_READ);
        return dashboard.view(patientId, "DOCTOR".equals(who.role()));
    }

    /** Her levels after each session, for the trend chart. */
    @GetMapping("/caregiver/patients/{patientId}/timeseries")
    public List<Dto.TimePoint> timeseries(@PathVariable String patientId, @RequestParam(defaultValue = "30") int days) {
        guard.require(patientId, Capability.CLINICAL_READ);
        return dashboard.timeseries(patientId, days);
    }

    /** The latest sessions, each with what it said and why. Never the raw trials. */
    @GetMapping("/caregiver/patients/{patientId}/sessions")
    public List<Dto.SessionRow> sessions(@PathVariable String patientId, @RequestParam(defaultValue = "20") int limit) {
        guard.require(patientId, Capability.CLINICAL_READ);
        return dashboard.recentSessions(patientId, limit);
    }

    @GetMapping("/caregiver/patients/{patientId}/alerts")
    public List<Dto.AlertView> alerts(@PathVariable String patientId, @RequestParam(defaultValue = "false") boolean all) {
        guard.require(patientId, Capability.CLINICAL_READ);
        return alerts.forPatient(patientId, !all).stream().map(DashboardService::alertView).toList();
    }

    /** How her journal entries have read, as signals only: never the words, and not the model's gist either. */
    @GetMapping("/caregiver/patients/{patientId}/sentiment")
    public List<Dto.SentimentPoint> sentiment(@PathVariable String patientId, @RequestParam(defaultValue = "30") int days) {
        guard.require(patientId, Capability.CLINICAL_READ);
        return dashboard.sentiment(patientId, days);
    }

    /**
     * A live stream of "something changed" for this patient. Each event names what
     * changed and nothing more; the dashboard then reads it through the endpoints
     * above. The stream is re-authorised before every event it sends.
     */
    @GetMapping(value = "/caregiver/patients/{patientId}/events", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public SseEmitter events(@PathVariable String patientId) {
        SmaranPrincipal who = guard.require(patientId, Capability.CLINICAL_READ);
        return events.open(patientId, who);
    }

    /** Someone has seen it. A doctor cannot: acknowledging is the family's act. */
    @PostMapping("/patients/{patientId}/alerts/{alertId}/acknowledge")
    public Dto.AlertView acknowledge(@PathVariable String patientId, @PathVariable String alertId) {
        SmaranPrincipal who = guard.require(patientId, Capability.CAREGIVE);
        return DashboardService.alertView(alerts.acknowledge(patientId, alertId, who.userId()));
    }

    /** One page, for the eleven minutes a neurologist has. */
    @GetMapping("/report/patient/{patientId}")
    public ResponseEntity<byte[]> report(@PathVariable String patientId) {
        SmaranPrincipal who = guard.require(patientId, Capability.CLINICAL_READ);
        byte[] pdf = reports.render(dashboard.view(patientId, "DOCTOR".equals(who.role())));
        return ResponseEntity.ok()
                .contentType(MediaType.APPLICATION_PDF)
                .header(
                        HttpHeaders.CONTENT_DISPOSITION,
                        "inline; filename=\"smaran-%s.pdf\"".formatted(patientId))
                .body(pdf);
    }

    @GetMapping("/biomarker/{patientId}/trend")
    public Dto.TrendResult voiceTrend(@PathVariable String patientId) {
        guard.require(patientId, Capability.CLINICAL_READ);
        return biomarkers.computeTrend(patientId);
    }

    /* -------------------------------------------------------- reminders */

    @PutMapping("/reminder/{patientId}/schedule")
    public List<Dto.ReminderDto> replace(@PathVariable String patientId, @RequestBody List<Dto.ReminderDto> body) {
        guard.require(patientId, Capability.CAREGIVE);
        List<ReminderSchedule> next = body.stream()
                .map(dto -> {
                    ReminderSchedule r = new ReminderSchedule();
                    r.setPatientId(patientId);
                    r.setType(org.smaran.domain.Enums.ReminderType.valueOf(dto.type()));
                    r.setScheduledTime(dto.scheduledTime());
                    r.setMessageTemplate(dto.messageTemplate());
                    r.setLanguageCode(dto.languageCode() == null ? "en" : dto.languageCode());
                    return r;
                })
                .toList();
        return reminders.replace(patientId, next).stream().map(CaregiverController::toDto).toList();
    }

    @PostMapping("/reminder/trigger")
    public void trigger(@RequestBody Dto.TriggerRequest body) {
        guard.require(body.patientId(), Capability.CAREGIVE);
        reminders.testFor(body.patientId());
    }

    static Dto.ReminderDto toDto(ReminderSchedule r) {
        return new Dto.ReminderDto(
                r.getId(),
                r.getPatientId(),
                r.getType().name(),
                r.getScheduledTime(),
                r.getPhotoS3Key(),
                r.getMessageTemplate(),
                r.getLanguageCode());
    }
}
