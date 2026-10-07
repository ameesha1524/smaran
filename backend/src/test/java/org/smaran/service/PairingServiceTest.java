package org.smaran.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import io.jsonwebtoken.Claims;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneId;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.smaran.config.JwtService;
import org.smaran.domain.DevicePairing;
import org.smaran.repo.DevicePairingRepository;
import org.smaran.repo.PatientRepository;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

/**
 * Pairing's promises, as tests: the code is never stored, it works once and
 * briefly, guessing is throttled, and removing a tablet ends its access.
 */
class PairingServiceTest {

    private static final String SECRET = "test-secret-test-secret-test-secret-32b";
    private static final String PATIENT = "patient-1";

    private DevicePairingRepository repo;
    private PatientRepository patients;
    private JwtService jwt;
    private PairingService service;
    private MutableClock clock;

    @BeforeEach
    void setUp() {
        repo = mock(DevicePairingRepository.class);
        patients = mock(PatientRepository.class);
        jwt = new JwtService(SECRET, 15);
        // Three failures per fifteen minutes, so the limit is cheap to reach.
        service = new PairingService(repo, patients, jwt, SECRET, 10, 180, 3, 15);
        clock = new MutableClock(Instant.now().truncatedTo(ChronoUnit.SECONDS));
        service.useClock(clock);
        when(patients.existsById(PATIENT)).thenReturn(true);
    }

    /* ----------------------------------------------------------- codes */

    @Test
    @DisplayName("codes are eight symbols from the unambiguous alphabet")
    void codeShape() {
        for (int i = 0; i < 200; i++) {
            String code = service.generateCode();
            assertEquals(8, code.length());
            for (char c : code.toCharArray()) {
                assertTrue(PairingService.ALPHABET.indexOf(c) >= 0, "unexpected " + c);
            }
        }
        for (char banned : "ILOU01".toCharArray()) {
            assertEquals(-1, PairingService.ALPHABET.indexOf(banned));
        }
    }

    @Test
    @DisplayName("typing is forgiving about case, spaces and the dash — and strict about the rest")
    void normalise() {
        assertEquals("ABCDEFGH", PairingService.normalise("abcd-efgh"));
        assertEquals("ABCDEFGH", PairingService.normalise(" ab cd efgh "));
        assertNull(PairingService.normalise("ABCD-EFG1"));
        assertNull(PairingService.normalise("ABCD"));
        assertNull(PairingService.normalise(null));
        assertEquals("ABCD-EFGH", PairingService.format("ABCDEFGH"));
    }

    @Test
    @DisplayName("the stored hash is keyed, stable, and never the code")
    void hashing() {
        String h = service.hash("ABCDEFGH");
        assertEquals(64, h.length());
        assertEquals(h, service.hash("ABCDEFGH"));
        assertFalse(h.contains("ABCDEFGH"));
        assertFalse(h.equals(service.hash("ABCDEFGJ")));
    }

    @Test
    @DisplayName("issuing stores only the hash, expires in ten minutes, and retires unused codes")
    void issue() {
        when(repo.existsByCodeHash(anyString())).thenReturn(false);
        PairingService.IssuedCode issued = service.issueCode(PATIENT, "carer-1");

        ArgumentCaptor<DevicePairing> saved = ArgumentCaptor.forClass(DevicePairing.class);
        verify(repo).save(saved.capture());
        verify(repo).retireUnusedCodes(PATIENT, clock.instant());

        DevicePairing row = saved.getValue();
        assertEquals(service.hash(PairingService.normalise(issued.code())), row.getCodeHash());
        assertEquals(clock.instant().plus(Duration.ofMinutes(10)), row.getExpiresAt());
        assertEquals("carer-1", row.getCreatedBy());
        assertTrue(issued.code().matches("[A-Z2-9]{4}-[A-Z2-9]{4}"));
    }

    @Test
    @DisplayName("no code for a patient who doesn't exist")
    void issueUnknown() {
        var e = assertThrows(ResponseStatusException.class, () -> service.issueCode("nobody", "carer-1"));
        assertEquals(HttpStatus.NOT_FOUND, e.getStatusCode());
        verify(repo, never()).save(any());
    }

    /* ---------------------------------------------------------- redeem */

    private DevicePairing pending(String code) {
        DevicePairing row = new DevicePairing();
        row.setPatientId(PATIENT);
        row.setCodeHash(service.hash(code));
        row.setExpiresAt(clock.instant().plus(Duration.ofMinutes(10)));
        when(repo.findByCodeHash(service.hash(code))).thenReturn(Optional.of(row));
        return row;
    }

    @Test
    @DisplayName("a redeemed code yields a device token scoped to her alone")
    void redeem() {
        DevicePairing row = pending("ABCDEFGH");
        when(repo.claim(eq(row.getId()), any(), eq("Living room"), any())).thenReturn(1);

        PairingService.Redemption r = service.redeem("abcd-efgh", "Living room", "10.0.0.1");

        Claims claims = jwt.parse(r.deviceToken());
        assertNotNull(claims);
        assertEquals(PATIENT, claims.getSubject());
        assertEquals("PATIENT", claims.get("role", String.class));
        assertEquals(List.of(PATIENT), claims.get("patients", List.class));
        assertEquals(row.getId(), claims.get("did", String.class));
        assertFalse(jwt.isRefresh(claims));
        assertEquals(clock.instant().plus(Duration.ofDays(180)), r.expiresAt());
    }

    @Test
    @DisplayName("a used, expired or superseded code gets the same answer as a wrong one")
    void notClaimable() {
        DevicePairing row = pending("ABCDEFGH");
        when(repo.claim(eq(row.getId()), any(), anyString(), any())).thenReturn(0);
        var used = assertThrows(ResponseStatusException.class, () -> service.redeem("ABCDEFGH", null, "a"));
        var wrong = assertThrows(ResponseStatusException.class, () -> service.redeem("ZZZZZZZZ", null, "b"));
        var malformed = assertThrows(ResponseStatusException.class, () -> service.redeem("hello", null, "c"));
        assertEquals(HttpStatus.NOT_FOUND, used.getStatusCode());
        assertEquals(used.getStatusCode(), wrong.getStatusCode());
        assertEquals(used.getReason(), wrong.getReason());
        assertEquals(used.getReason(), malformed.getReason());
    }

    @Test
    @DisplayName("repeated failures lock that client out — even from a valid code — for the window only")
    void rateLimited() {
        for (int i = 0; i < 3; i++) {
            assertThrows(ResponseStatusException.class, () -> service.redeem("ZZZZZZZZ", null, "attacker"));
        }
        DevicePairing row = pending("ABCDEFGH");
        when(repo.claim(eq(row.getId()), any(), anyString(), any())).thenReturn(1);

        var locked = assertThrows(ResponseStatusException.class, () -> service.redeem("ABCDEFGH", null, "attacker"));
        assertEquals(HttpStatus.TOO_MANY_REQUESTS, locked.getStatusCode());
        verify(repo, never()).claim(anyString(), any(), anyString(), any());

        // Someone else is unaffected, and the lock lifts once the window passes.
        assertNotNull(service.redeem("ABCDEFGH", null, "family"));
        clock.advance(Duration.ofMinutes(16));
        assertNotNull(service.redeem("ABCDEFGH", null, "attacker"));
    }

    /* --------------------------------------------------------- devices */

    private DevicePairing paired() {
        DevicePairing row = new DevicePairing();
        row.setPatientId(PATIENT);
        row.setCodeHash("x");
        row.setExpiresAt(clock.instant().minus(Duration.ofMinutes(5)));
        row.setRedeemedAt(clock.instant().minus(Duration.ofMinutes(10)));
        row.setTokenExpiresAt(clock.instant().plus(Duration.ofDays(100)));
        row.setLastSeenAt(clock.instant());
        when(repo.findById(row.getId())).thenReturn(Optional.of(row));
        when(repo.findByIdAndPatientId(row.getId(), PATIENT)).thenReturn(Optional.of(row));
        return row;
    }

    @Test
    @DisplayName("removing a tablet ends its access immediately, not at the next cache refresh")
    void revoke() {
        DevicePairing row = paired();
        assertTrue(service.isDeviceActive(row.getId()));

        service.revoke(PATIENT, row.getId());
        assertNotNull(row.getRevokedAt());
        assertFalse(service.isDeviceActive(row.getId()));
    }

    @Test
    @DisplayName("the per-request check is cached, and last-seen is written coarsely")
    void cached() {
        DevicePairing row = paired();
        assertTrue(service.isDeviceActive(row.getId()));
        assertTrue(service.isDeviceActive(row.getId()));
        verify(repo, times(1)).findById(row.getId());
        verify(repo, never()).touch(anyString(), any());

        clock.advance(Duration.ofMinutes(11));
        assertTrue(service.isDeviceActive(row.getId()));
        verify(repo).touch(row.getId(), clock.instant());
    }

    @Test
    @DisplayName("an expired device token is not honoured")
    void expiredDevice() {
        DevicePairing row = paired();
        row.setTokenExpiresAt(clock.instant().minusSeconds(1));
        assertFalse(service.isDeviceActive(row.getId()));
    }

    @Test
    @DisplayName("someone else's patient's tablet cannot be removed through this one")
    void revokeWrongPatient() {
        DevicePairing row = paired();
        var e = assertThrows(ResponseStatusException.class, () -> service.revoke("patient-2", row.getId()));
        assertEquals(HttpStatus.NOT_FOUND, e.getStatusCode());
    }

    @Test
    @DisplayName("labels are the family's words, kept printable and bounded")
    void labels() {
        assertEquals("Tablet", PairingService.label(null));
        assertEquals("Tablet", PairingService.label("   "));
        assertEquals("Living room", PairingService.label("  Living\u0007 room "));
        assertEquals(120, PairingService.label("x".repeat(500)).length());
    }

    /* --------------------------------------------------------- helpers */

    static final class MutableClock extends Clock {
        private Instant now;

        MutableClock(Instant start) {
            this.now = start;
        }

        void advance(Duration d) {
            now = now.plus(d);
        }

        @Override
        public ZoneId getZone() {
            return ZoneId.of("UTC");
        }

        @Override
        public Clock withZone(ZoneId zone) {
            return this;
        }

        @Override
        public Instant instant() {
            return now;
        }
    }
}
