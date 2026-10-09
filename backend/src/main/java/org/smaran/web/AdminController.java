package org.smaran.web;

import jakarta.servlet.http.HttpServletRequest;
import java.util.List;
import org.smaran.config.AccessGuard;
import org.smaran.domain.AppUser.Status;
import org.smaran.service.AdminService;
import org.smaran.service.AuditService;
import org.springframework.http.HttpStatus;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

/** Approve doctors, switch accounts off, read the whole audit log. ADMIN only. */
@RestController
@RequestMapping("/api/admin")
@PreAuthorize("@roles.any('ADMIN')")
public class AdminController {

    private final AdminService admin;
    private final AuditService audit;
    private final AccessGuard guard;

    public AdminController(AdminService admin, AuditService audit, AccessGuard guard) {
        this.admin = admin;
        this.audit = audit;
        this.guard = guard;
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
