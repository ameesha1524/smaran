package org.smaran.config;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.util.List;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.smaran.domain.AppUser;
import org.smaran.domain.Enums.Role;
import org.smaran.repo.AppUserRepository;
import org.smaran.service.AuditService;
import org.springframework.context.annotation.Profile;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;

/** The first administrator comes from the environment, once, and never from source. */
class AdminBootstrapTest {

    private final AppUserRepository users = mock(AppUserRepository.class);
    private final AuditService audit = mock(AuditService.class);
    private final PasswordEncoder encoder = new BCryptPasswordEncoder(4);

    private AdminBootstrap with(String email, String password) {
        return new AdminBootstrap(users, encoder, audit, email, password);
    }

    @Test
    @DisplayName("creates an admin from the environment when there is none, storing only a hash")
    void creates() {
        when(users.existsByRole(Role.ADMIN)).thenReturn(false);
        with("Boss@Example.com", "a-long-first-password").run(null);

        ArgumentCaptor<AppUser> saved = ArgumentCaptor.forClass(AppUser.class);
        verify(users).save(saved.capture());
        assertEquals("boss@example.com", saved.getValue().getEmail());
        assertEquals(Role.ADMIN, saved.getValue().getRole());
        assertFalse(saved.getValue().getPasswordHash().contains("a-long-first-password"));
        assertTrue(encoder.matches("a-long-first-password", saved.getValue().getPasswordHash()));
    }

    @Test
    @DisplayName("does nothing when an admin already exists, so a restart cannot reset the account")
    void idempotent() {
        when(users.existsByRole(Role.ADMIN)).thenReturn(true);
        with("boss@example.com", "a-long-first-password").run(null);
        verify(users, never()).save(any());
    }

    @Test
    @DisplayName("does nothing, and does not fail, when the environment is not set")
    void notConfigured() {
        when(users.existsByRole(Role.ADMIN)).thenReturn(false);
        with("", "").run(null);
        with("boss@example.com", "").run(null);
        verify(users, never()).save(any());
    }

    @Test
    @DisplayName("refuses to start on a weak first password, and the message does not repeat it")
    void weakPassword() {
        when(users.existsByRole(Role.ADMIN)).thenReturn(false);
        IllegalStateException e = assertThrows(IllegalStateException.class,
                () -> with("boss@example.com", "password123").run(null));
        assertFalse(e.getMessage().contains("password123"));
        verify(users, never()).save(any());
    }

    @Test
    @DisplayName("the demo accounts can only be created in dev and demo, never prod or test")
    void seederProfiles() {
        Profile profile = DemoDataSeeder.class.getAnnotation(Profile.class);
        assertTrue(List.of(profile.value()).containsAll(List.of("dev", "demo")));
        assertFalse(List.of(profile.value()).contains("prod"));
        assertFalse(List.of(profile.value()).contains("test"));
    }
}
