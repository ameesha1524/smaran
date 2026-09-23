package org.smaran.web;

import java.util.List;
import org.smaran.config.AccessGuard;
import org.smaran.domain.ReminderSchedule;
import org.smaran.service.AudioBiomarkerService;
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
import org.springframework.web.bind.annotation.RestController;

/**
 * Everything the caregiver and the doctor read: the dashboard, the PDF, the
 * voice trend, and the reminder schedule.
 */
@RestController
@RequestMapping("/api")
public class CaregiverController {

    private final DashboardService dashboard;
    private final ReportService reports;
    private final ReminderService reminders;
    private final AudioBiomarkerService biomarkers;
    private final AccessGuard guard;

    public CaregiverController(
            DashboardService dashboard,
            ReportService reports,
            ReminderService reminders,
            AudioBiomarkerService biomarkers,
            AccessGuard guard) {
        this.dashboard = dashboard;
        this.reports = reports;
        this.reminders = reminders;
        this.biomarkers = biomarkers;
        this.guard = guard;
    }

    @GetMapping("/caregiver/dashboard/{patientId}")
    public Dto.DashboardSummary summary(@PathVariable String patientId) {
        guard.requireAccessTo(patientId);
        return dashboard.summary(patientId);
    }

    /** One page, for the eleven minutes a neurologist has. */
    @GetMapping("/report/patient/{patientId}")
    public ResponseEntity<byte[]> report(@PathVariable String patientId) {
        guard.requireAccessTo(patientId);
        Dto.DashboardSummary summary = dashboard.summary(patientId);
        byte[] pdf = reports.render(summary);
        return ResponseEntity.ok()
                .contentType(MediaType.APPLICATION_PDF)
                .header(
                        HttpHeaders.CONTENT_DISPOSITION,
                        "inline; filename=\"smaran-%s.pdf\"".formatted(patientId))
                .body(pdf);
    }

    @GetMapping("/biomarker/{patientId}/trend")
    public Dto.TrendResult voiceTrend(@PathVariable String patientId) {
        guard.requireAccessTo(patientId);
        return biomarkers.computeTrend(patientId);
    }

    /* -------------------------------------------------------- reminders */

    @GetMapping("/reminder/{patientId}/schedule")
    public List<Dto.ReminderDto> schedule(@PathVariable String patientId) {
        guard.requireAccessTo(patientId);
        return reminders.forPatient(patientId).stream().map(CaregiverController::toDto).toList();
    }

    @PutMapping("/reminder/{patientId}/schedule")
    public List<Dto.ReminderDto> replace(@PathVariable String patientId, @RequestBody List<Dto.ReminderDto> body) {
        guard.requireAccessTo(patientId);
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
        guard.requireAccessTo(body.patientId());
        reminders.testFor(body.patientId());
    }

    private static Dto.ReminderDto toDto(ReminderSchedule r) {
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
