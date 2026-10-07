package org.smaran.config;

import lombok.extern.slf4j.Slf4j;
import org.smaran.domain.AppUser;
import org.smaran.domain.Enums.Role;
import org.smaran.repo.AppUserRepository;
import org.smaran.service.AuditService;
import org.smaran.service.AuditService.Actor;
import org.smaran.service.PasswordPolicy;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Component;

/**
 * Creates the first administrator from the environment, once.
 *
 * {@code ADMIN_EMAIL} and {@code ADMIN_PASSWORD} are read at start-up. If no
 * admin exists, one is created from them; if one does, they are ignored, so
 * restarting with a changed password does not silently reset an account. The
 * password has to pass the same policy as any other, and is never logged.
 * Nothing in source code can create an administrator.
 */
@Component
@Slf4j
public class AdminBootstrap implements ApplicationRunner {

    private final AppUserRepository users;
    private final PasswordEncoder encoder;
    private final AuditService audit;
    private final String email;
    private final String password;

    public AdminBootstrap(
            AppUserRepository users,
            PasswordEncoder encoder,
            AuditService audit,
            @Value("${smaran.bootstrap.admin-email:}") String email,
            @Value("${smaran.bootstrap.admin-password:}") String password) {
        this.users = users;
        this.encoder = encoder;
        this.audit = audit;
        this.email = email == null ? "" : email.trim().toLowerCase();
        this.password = password == null ? "" : password;
    }

    @Override
    public void run(ApplicationArguments args) {
        if (users.existsByRole(Role.ADMIN)) {
            return;
        }
        if (email.isEmpty() || password.isEmpty()) {
            log.warn("No administrator exists and ADMIN_EMAIL / ADMIN_PASSWORD are not set. "
                    + "Doctors cannot be approved until one is created.");
            return;
        }
        var problems = PasswordPolicy.problems(password, email);
        if (!problems.isEmpty()) {
            // Fail start-up: a weak first admin password is worse than no admin.
            throw new IllegalStateException("ADMIN_PASSWORD is not acceptable: " + String.join(" ", problems));
        }
        if (users.existsByEmail(email)) {
            throw new IllegalStateException("ADMIN_EMAIL is already used by a non-admin account.");
        }
        AppUser admin = new AppUser();
        admin.setEmail(email);
        admin.setName("Administrator");
        admin.setPasswordHash(encoder.encode(password));
        admin.setRole(Role.ADMIN);
        users.save(admin);
        audit.record(Actor.SYSTEM, admin.getId(), "ADMIN_BOOTSTRAPPED", null, null, null, null);
        log.info("Created the first administrator account.");
    }
}
