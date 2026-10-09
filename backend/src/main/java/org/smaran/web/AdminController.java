package org.smaran.web;

import jakarta.servlet.http.HttpServletRequest;
import java.io.IOException;
import java.io.StringWriter;
import java.util.List;
import java.util.Map;
import org.smaran.config.AccessGuard;
import org.smaran.domain.AppUser.Status;
import org.smaran.service.AdminService;
import org.smaran.service.AuditService;
import org.smaran.service.ExportService;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

/** Approve doctors, switch accounts off, read the whole audit log, export the de-identified dataset. ADMIN only. */
@RestController
@RequestMapping("/api/admin")
@PreAuthorize("@roles.any('ADMIN')")
public class AdminController {

    private final AdminService admin;
    private final AuditService audit;
    private final AccessGuard guard;
    private final ExportService export;

    public AdminController(AdminService admin, AuditService audit, AccessGuard guard, ExportService export) {
        this.admin = admin;
        this.audit = audit;
        this.guard = guard;
        this.export = export;
    }

    @GetMapping("/users")
    public List<Dto.AdminUserDto> users(@RequestParam(required = false) String status) {
        return admin.list(parse(status));
    }

    @PostMapping("/users/{userId}/approve")
    public Dto.AdminUserDto approve(@PathVariable String userId, HttpServletRequest request) {
        return admin.approve(guard.currentUserId(), userId, request.getRemoteAddr());
    }

    @PostMapping("/users/{userId}/disable")
    public Dto.AdminUserDto disable(@PathVariable String userId, HttpServletRequest request) {
        return admin.disable(guard.currentUserId(), userId, request.getRemoteAddr());
    }

    @GetMapping("/audit")
    public List<AuditService.Event> audit(@RequestParam(defaultValue = "200") int limit) {
        return audit.all(limit);
    }

    /**
     * Every stored score as one CSV row, with the patient as a keyed hash, days instead of dates and
     * no free text (see {@link ExportService}). The export is recorded in the audit log with its size.
     */
    @GetMapping(value = "/export/sessions.csv", produces = "text/csv")
    public ResponseEntity<String> exportSessions(HttpServletRequest request) throws IOException {
        StringWriter csv = new StringWriter();
        ExportService.Result result = export.write(csv);
        audit.record(AuditService.Actor.ADMIN, guard.currentUserId(), "EXPORT_SESSIONS", null, "export/sessions.csv",
                request.getRemoteAddr(),
                Map.of("patients", result.patients(), "sessions", result.sessions(), "rows", result.rows()));
        return ResponseEntity.ok()
                .contentType(new MediaType("text", "csv"))
                .header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=\"smaran-sessions.csv\"")
                .cacheControl(CacheControl.noStore())
                .body(csv.toString());
    }

    private static Status parse(String status) {
        if (status == null || status.isBlank()) {
            return null;
        }
        try {
            return Status.valueOf(status.toUpperCase());
        } catch (IllegalArgumentException e) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Unknown status.");
        }
    }
}
