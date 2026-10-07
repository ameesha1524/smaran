package org.smaran;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

import com.fasterxml.jackson.databind.JsonNode;
import jakarta.servlet.http.Cookie;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.Base64;
import java.util.Date;
import java.util.List;
import java.util.Map;
import javax.crypto.SecretKey;
import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.security.Keys;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.smaran.config.JwtService;
import org.smaran.domain.AppUser;
import org.smaran.domain.AppUser.Status;
import org.smaran.domain.Enums.Role;
import org.smaran.support.ApiTest;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.web.servlet.MvcResult;

/** Registration, sign-in, lockout, refresh rotation and reuse, tampering. All through real HTTP on PostgreSQL. */
class AuthFlowIT extends ApiTest {

    /** The secret the `test` profile signs with. */
    private static final String TEST_SECRET = "test-only-secret-test-only-secret-test-32";

    @Autowired
    JdbcTemplate jdbc;

    private MvcResult register(Map<String, String> body, String ip) throws Exception {
        return mvc.perform(post("/api/auth/register").with(from(ip))
                        .contentType(MediaType.APPLICATION_JSON).content(json.writeValueAsString(body)))
                .andReturn();
    }

    private static Map<String, String> signup(String email, String role) {
        return Map.of("name", "New Person", "email", email, "password", PASSWORD, "role", role);
    }

    private static String uniqueEmail() {
        return "n" + java.util.UUID.randomUUID().toString().substring(0, 12) + "@example.com";
    }

    private int meStatus(String token) throws Exception {
        var req = get("/api/auth/me");
        if (token != null) {
            req.header("Authorization", bearer(token));
        }
        return mvc.perform(req).andReturn().getResponse().getStatus();
    }

    private Signed refresh(String cookie, String ip) throws Exception {
        var req = post("/api/auth/refresh").with(from(ip));
        if (cookie != null) {
            req.cookie(new Cookie("smaran_rt", cookie));
        }
        return signed(mvc.perform(req).andReturn());
    }

    /* ------------------------------------------------------- registration */

    @Test
    @DisplayName("a caregiver registers, is signed in, and the refresh token is only ever a cookie")
    void caregiverRegisters() throws Exception {
        MvcResult r = register(signup(uniqueEmail(), "CAREGIVER"), freshIp());
        assertEquals(201, r.getResponse().getStatus());
        Signed s = signed(r);
        assertNotNull(s.accessToken());
        assertEquals(200, meStatus(s.accessToken()));

        String setCookie = r.getResponse().getHeader("Set-Cookie");
        assertNotNull(setCookie);
        assertTrue(setCookie.contains("HttpOnly"), setCookie);
        assertTrue(setCookie.contains("Secure"), setCookie);
        assertTrue(setCookie.contains("SameSite=Strict"), setCookie);
        assertTrue(setCookie.contains("Path=/api/auth"), setCookie);
        assertNotNull(s.refreshCookie());
        assertFalse(r.getResponse().getContentAsString().contains(s.refreshCookie()),
                "the refresh token must not appear in a response body");
        assertEquals("no-store", r.getResponse().getHeader("Cache-Control"));
    }

    @Test
    @DisplayName("registration refuses a weak password, a bad email, a duplicate, and an admin role")
    void registrationRefusals() throws Exception {
        assertEquals(400, register(Map.of("name", "A", "email", uniqueEmail(), "password", "short", "role", "CAREGIVER"), freshIp())
                .getResponse().getStatus());
        assertEquals(400, register(Map.of("name", "A", "email", uniqueEmail(), "password", "password123", "role", "CAREGIVER"), freshIp())
                .getResponse().getStatus());
        assertEquals(400, register(signup("not-an-email", "CAREGIVER"), freshIp()).getResponse().getStatus());
        assertEquals(400, register(signup(uniqueEmail(), "ADMIN"), freshIp()).getResponse().getStatus());

        String email = uniqueEmail();
        assertEquals(201, register(signup(email, "CAREGIVER"), freshIp()).getResponse().getStatus());
        assertEquals(409, register(signup(email.toUpperCase(), "CAREGIVER"), freshIp()).getResponse().getStatus());
    }

    @Test
    @DisplayName("a doctor registers pending, cannot sign in, and can once an admin approves")
    void doctorApproval() throws Exception {
        String email = uniqueEmail();
        MvcResult r = register(signup(email, "DOCTOR"), freshIp());
        assertEquals(201, r.getResponse().getStatus());
        assertNull(signed(r).accessToken(), "a pending doctor gets no token");
        assertNull(signed(r).refreshCookie());
        String id = json.readTree(r.getResponse().getContentAsString()).get("userId").asText();

        assertEquals(403, loginFull(email, PASSWORD, freshIp()).result().getResponse().getStatus());

        String adminToken = tokenFor(newUser(Role.ADMIN));
        JsonNode pending = json.readTree(mvc.perform(get("/api/admin/users").param("status", "PENDING")
                        .header("Authorization", bearer(adminToken))).andReturn().getResponse().getContentAsString());
        assertTrue(pending.toString().contains(id), "the admin sees the pending doctor");

        assertEquals(200, mvc.perform(post("/api/admin/users/" + id + "/approve")
                .header("Authorization", bearer(adminToken))).andReturn().getResponse().getStatus());
        assertNotNull(loginFull(email, PASSWORD, freshIp()).accessToken());
    }

    @Test
    @DisplayName("a caregiver cannot approve a doctor, even themselves into a doctor's role")
    void onlyAdminApproves() throws Exception {
        AppUser pendingDoctor = newUser(Role.DOCTOR, Status.PENDING);
        String caregiverToken = tokenFor(newUser(Role.CAREGIVER));
        assertEquals(403, mvc.perform(post("/api/admin/users/" + pendingDoctor.getId() + "/approve")
                .header("Authorization", bearer(caregiverToken))).andReturn().getResponse().getStatus());
    }

    /* ------------------------------------------------------------- sign-in */

    @Test
    @DisplayName("every way of failing to sign in gives the same answer")
    void uniformFailure() throws Exception {
        AppUser real = newUser(Role.CAREGIVER);
        AppUser disabled = newUser(Role.CAREGIVER, Status.DISABLED);

        MvcResult wrongPassword = loginFull(real.getEmail(), "wrong-password-here", freshIp()).result();
        MvcResult noSuchUser = loginFull(uniqueEmail(), PASSWORD, freshIp()).result();
        MvcResult disabledUser = loginFull(disabled.getEmail(), PASSWORD, freshIp()).result();

        for (MvcResult r : List.of(wrongPassword, noSuchUser, disabledUser)) {
            assertEquals(401, r.getResponse().getStatus());
            assertEquals(wrongPassword.getResponse().getContentAsString(), r.getResponse().getContentAsString());
            assertNull(r.getResponse().getHeader("Set-Cookie"));
        }
    }

    @Test
    @DisplayName("five wrong passwords lock the account, even against the right password, until the lock lapses")
    void lockout() throws Exception {
        AppUser user = newUser(Role.CAREGIVER);
        for (int i = 0; i < 5; i++) {
            assertEquals(401, loginFull(user.getEmail(), "wrong-password-" + i, freshIp()).result().getResponse().getStatus());
        }
        // Locked: the correct password now gets the same refusal as a wrong one.
        MvcResult locked = loginFull(user.getEmail(), PASSWORD, freshIp()).result();
        assertEquals(401, locked.getResponse().getStatus());
        assertEquals(loginFull(user.getEmail(), "still-wrong-one", freshIp()).result().getResponse().getContentAsString(),
                locked.getResponse().getContentAsString());

        jdbc.update("update app_user set locked_until = now() - interval '1 minute' where id = ?", user.getId());
        assertNotNull(loginFull(user.getEmail(), PASSWORD, freshIp()).accessToken(), "the lock has lapsed");
    }

    @Test
    @DisplayName("a successful sign-in clears the count of failures")
    void successClearsFailures() throws Exception {
        AppUser user = newUser(Role.CAREGIVER);
        for (int i = 0; i < 4; i++) {
            loginFull(user.getEmail(), "wrong-password-" + i, freshIp());
        }
        assertNotNull(loginFull(user.getEmail(), PASSWORD, freshIp()).accessToken());
        for (int i = 0; i < 4; i++) {
            loginFull(user.getEmail(), "wrong-again-" + i, freshIp());
        }
        assertNotNull(loginFull(user.getEmail(), PASSWORD, freshIp()).accessToken(), "four more failures is still under five");
    }

    @Test
    @DisplayName("one address making many failed attempts is refused, for any account")
    void perAddressLimit() throws Exception {
        String ip = freshIp();
        for (int i = 0; i < 20; i++) {
            assertEquals(401, loginFull(uniqueEmail(), "whatever-it-is-123", ip).result().getResponse().getStatus());
        }
        AppUser real = newUser(Role.CAREGIVER);
        assertEquals(429, loginFull(real.getEmail(), PASSWORD, ip).result().getResponse().getStatus());
        assertNotNull(loginFull(real.getEmail(), PASSWORD, freshIp()).accessToken(), "another address is unaffected");
    }

    /* ------------------------------------------------------------- refresh */

    @Test
    @DisplayName("refresh rotates: a new token each time, and the old one stops working")
    void refreshRotates() throws Exception {
        AppUser user = newUser(Role.CAREGIVER);
        Signed first = loginFull(user.getEmail(), PASSWORD, freshIp());

        Signed second = refresh(first.refreshCookie(), freshIp());
        assertNotNull(second.accessToken());
        assertNotNull(second.refreshCookie());
        assertNotEquals(first.refreshCookie(), second.refreshCookie());
        assertEquals(200, meStatus(second.accessToken()));

        Signed third = refresh(second.refreshCookie(), freshIp());
        assertNotNull(third.accessToken());
    }

    @Test
    @DisplayName("presenting a used refresh token revokes the whole family, including the newest token")
    void reuseRevokesFamily() throws Exception {
        AppUser user = newUser(Role.CAREGIVER);
        Signed first = loginFull(user.getEmail(), PASSWORD, freshIp());
        Signed second = refresh(first.refreshCookie(), freshIp());

        // An attacker (or a second copy) presents the first token again.
        assertEquals(401, refresh(first.refreshCookie(), freshIp()).result().getResponse().getStatus());

        // The legitimate holder of the newest token is signed out too.
        assertEquals(401, refresh(second.refreshCookie(), freshIp()).result().getResponse().getStatus());

        Integer reuse = jdbc.queryForObject(
                "select count(*) from audit_event where action = 'REFRESH_REUSE' and actor_id = ?", Integer.class, user.getId());
        assertEquals(1, reuse);

        // A fresh sign-in starts a new family and works.
        assertNotNull(loginFull(user.getEmail(), PASSWORD, freshIp()).accessToken());
    }

    @Test
    @DisplayName("two families are independent: reuse on one device does not sign out another")
    void familiesAreIndependent() throws Exception {
        AppUser user = newUser(Role.CAREGIVER);
        Signed phone = loginFull(user.getEmail(), PASSWORD, freshIp());
        Signed laptop = loginFull(user.getEmail(), PASSWORD, freshIp());
        Signed phone2 = refresh(phone.refreshCookie(), freshIp());
        refresh(phone.refreshCookie(), freshIp()); // reuse on the phone's family
        assertEquals(401, refresh(phone2.refreshCookie(), freshIp()).result().getResponse().getStatus());
        assertNotNull(refresh(laptop.refreshCookie(), freshIp()).accessToken());
    }

    @Test
    @DisplayName("refresh with no cookie, a made-up token, or an expired token is refused")
    void refreshRefusals() throws Exception {
        assertEquals(401, refresh(null, freshIp()).result().getResponse().getStatus());
        assertEquals(401, refresh("not-a-real-token", freshIp()).result().getResponse().getStatus());

        AppUser user = newUser(Role.CAREGIVER);
        Signed s = loginFull(user.getEmail(), PASSWORD, freshIp());
        jdbc.update("update refresh_token set expires_at = now() - interval '1 minute' where user_id = ?", user.getId());
        assertEquals(401, refresh(s.refreshCookie(), freshIp()).result().getResponse().getStatus());
    }

    @Test
    @DisplayName("only a hash of the refresh token is stored")
    void tokenIsHashed() throws Exception {
        AppUser user = newUser(Role.CAREGIVER);
        Signed s = loginFull(user.getEmail(), PASSWORD, freshIp());
        List<String> stored = jdbc.queryForList("select token_hash from refresh_token where user_id = ?", String.class, user.getId());
        assertEquals(1, stored.size());
        assertNotEquals(s.refreshCookie(), stored.get(0));
        assertEquals(64, stored.get(0).length());
    }

    @Test
    @DisplayName("logout ends the session: the refresh token no longer works, and the cookie is cleared")
    void logout() throws Exception {
        AppUser user = newUser(Role.CAREGIVER);
        Signed s = loginFull(user.getEmail(), PASSWORD, freshIp());
        MvcResult out = mvc.perform(post("/api/auth/logout").with(from(freshIp()))
                .cookie(new Cookie("smaran_rt", s.refreshCookie()))).andReturn();
        assertEquals(204, out.getResponse().getStatus());
        assertTrue(out.getResponse().getHeader("Set-Cookie").contains("Max-Age=0"));
        assertEquals(401, refresh(s.refreshCookie(), freshIp()).result().getResponse().getStatus());
        // Logging out again, or with nothing, is quiet.
        assertEquals(204, mvc.perform(post("/api/auth/logout")).andReturn().getResponse().getStatus());
    }

    @Test
    @DisplayName("switching an account off ends its refresh tokens at once")
    void disableRevokesRefresh() throws Exception {
        AppUser user = newUser(Role.CAREGIVER);
        Signed s = loginFull(user.getEmail(), PASSWORD, freshIp());
        String adminToken = tokenFor(newUser(Role.ADMIN));
        assertEquals(200, mvc.perform(post("/api/admin/users/" + user.getId() + "/disable")
                .header("Authorization", bearer(adminToken))).andReturn().getResponse().getStatus());
        assertEquals(401, refresh(s.refreshCookie(), freshIp()).result().getResponse().getStatus());
        assertEquals(401, loginFull(user.getEmail(), PASSWORD, freshIp()).result().getResponse().getStatus());
    }

    /* ---------------------------------------------------- token tampering */

    @Test
    @DisplayName("a tampered, forged, unsigned or expired access token is treated as no sign-in at all")
    void badTokens() throws Exception {
        AppUser user = newUser(Role.CAREGIVER);
        String good = tokenFor(user);
        assertEquals(200, meStatus(good));

        String[] parts = good.split("\\.");

        // Payload changed to claim another role, signature kept.
        String payload = new String(Base64.getUrlDecoder().decode(parts[1]), StandardCharsets.UTF_8)
                .replace("\"CAREGIVER\"", "\"ADMIN\"");
        String tampered = parts[0] + "." + Base64.getUrlEncoder().withoutPadding()
                .encodeToString(payload.getBytes(StandardCharsets.UTF_8)) + "." + parts[2];
        assertEquals(401, meStatus(tampered));

        // Signature damaged.
        assertEquals(401, meStatus(parts[0] + "." + parts[1] + "." + parts[2].substring(0, parts[2].length() - 3) + "AAA"));

        // alg=none, no signature.
        String none = Base64.getUrlEncoder().withoutPadding().encodeToString("{\"alg\":\"none\"}".getBytes(StandardCharsets.UTF_8))
                + "." + parts[1] + ".";
        assertEquals(401, meStatus(none));

        // Signed with a different secret.
        SecretKey other = Keys.hmacShaKeyFor("a-completely-different-secret-of-32-bytes!".getBytes(StandardCharsets.UTF_8));
        String forged = Jwts.builder().subject(user.getId()).claim("role", "ADMIN")
                .expiration(Date.from(Instant.now().plusSeconds(600))).signWith(other).compact();
        assertEquals(401, meStatus(forged));

        // Genuinely signed, but already expired.
        String expired = new JwtService(TEST_SECRET, -1).issueAccess(user.getId(), "CAREGIVER", List.of());
        assertEquals(401, meStatus(expired));

        // Garbage, and the empty bearer.
        assertEquals(401, meStatus("not.a.jwt"));
        assertEquals(401, meStatus(null));
    }

    @Test
    @DisplayName("a token for a caregiver cannot be used to claim admin by editing it, and endpoints stay closed")
    void tamperedRoleDoesNotOpenAdmin() throws Exception {
        String good = tokenFor(newUser(Role.CAREGIVER));
        assertEquals(403, mvc.perform(get("/api/admin/users").header("Authorization", bearer(good)))
                .andReturn().getResponse().getStatus());
        String[] parts = good.split("\\.");
        String payload = new String(Base64.getUrlDecoder().decode(parts[1]), StandardCharsets.UTF_8)
                .replace("\"CAREGIVER\"", "\"ADMIN\"");
        String tampered = parts[0] + "." + Base64.getUrlEncoder().withoutPadding()
                .encodeToString(payload.getBytes(StandardCharsets.UTF_8)) + "." + parts[2];
        assertEquals(401, mvc.perform(get("/api/admin/users").header("Authorization", bearer(tampered)))
                .andReturn().getResponse().getStatus());
    }

    @Test
    @DisplayName("an access token carries no list of patients")
    void tokenHasNoPatientList() throws Exception {
        AppUser owner = newUser(Role.CAREGIVER);
        newPatient(owner);
        String token = tokenFor(owner);
        String payload = new String(Base64.getUrlDecoder().decode(token.split("\\.")[1]), StandardCharsets.UTF_8);
        JsonNode claims = json.readTree(payload);
        assertEquals(0, claims.path("patients").size(), payload);
    }
}
