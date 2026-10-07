package org.smaran.service;

import java.time.Clock;
import java.util.List;
import java.util.Map;
import org.smaran.domain.AppUser;
import org.smaran.domain.AppUser.Status;
import org.smaran.domain.Enums.Role;
import org.smaran.repo.AppUserRepository;
import org.smaran.repo.RefreshTokenRepository;
import org.smaran.service.AuditService.Actor;
import org.smaran.web.Dto;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

/**
 * What only an administrator may do: approve doctors and switch accounts off.
 *
 * Disabling revokes the user's refresh tokens at once, so they cannot get a new
 * access token. An access token already issued works until it expires, at most
 * 15 minutes; that window is stated in docs/explainers/phase-2.md.
 */
@Service
@Transactional
public class AdminService {

    private final AppUserRepository users;
    private final RefreshTokenRepository refreshTokens;
    private final AuditService audit;
    private final Clock clock;

    public AdminService(AppUserRepository users, RefreshTokenRepository refreshTokens, AuditService audit, Clock clock) {
        this.users = users;
        this.refreshTokens = refreshTokens;
        this.audit = audit;
        this.clock = clock;
    }

    @Transactional(readOnly = true)
    public List<Dto.AdminUserDto> list(Status status) {
        List<AppUser> found = status == null ? users.findAllByOrderByCreatedAtAsc() : users.findByStatusOrderByCreatedAtAsc(status);
        return found.stream().map(AdminService::dto).toList();
    }

    public Dto.AdminUserDto approve(String adminId, String userId, String ip) {
        AppUser user = users.findById(userId).orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND));
        if (user.getRole() != Role.DOCTOR || user.getStatus() != Status.PENDING) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "Only a pending doctor can be approved.");
        }
        user.setStatus(Status.ACTIVE);
        users.save(user);
        audit.record(Actor.ADMIN, adminId, "DOCTOR_APPROVED", null, null, ip, Map.of("userId", userId));
        return dto(user);
    }

    public Dto.AdminUserDto disable(String adminId, String userId, String ip) {
        if (adminId.equals(userId)) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "You cannot switch off your own account.");
        }
        AppUser user = users.findById(userId).orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND));
        user.setStatus(Status.DISABLED);
        users.save(user);
        refreshTokens.revokeAllForUser(userId, clock.instant());
        audit.record(Actor.ADMIN, adminId, "USER_DISABLED", null, null, ip, Map.of("userId", userId));
        return dto(user);
    }

    private static Dto.AdminUserDto dto(AppUser u) {
        return new Dto.AdminUserDto(
                u.getId(), u.getName(), u.getEmail(), u.getRole().name(), u.getStatus().name(),
                u.getCreatedAt(), u.getLastLoginAt());
    }
}
