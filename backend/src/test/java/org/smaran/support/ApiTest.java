package org.smaran.support;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.http.Cookie;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;
import org.smaran.domain.AppUser;
import org.smaran.domain.AppUser.Status;
import org.smaran.domain.ConsentRecord;
import org.smaran.domain.DoctorGrant;
import org.smaran.domain.Enums.Role;
import org.smaran.domain.Patient;
import org.smaran.repo.AppUserRepository;
import org.smaran.repo.ConsentRecordRepository;
import org.smaran.repo.DoctorGrantRepository;
import org.smaran.repo.PatientRepository;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.request.RequestPostProcessor;

/**
 * Helpers for tests that drive the real HTTP API.
 *
 * Accounts are created in the database and then signed in through
 * POST /api/auth/login, so every token a test holds came from the real path.
 * Each call comes from its own fake client address, so the per-address login
 * limit never makes one test depend on another.
 */
public abstract class ApiTest extends PostgresIntegrationTest {

    public static final String PASSWORD = "correct-horse-battery";

    private static final AtomicInteger NEXT_IP = new AtomicInteger(1);

    @Autowired
    protected MockMvc mvc;

    @Autowired
    protected ObjectMapper json;

    @Autowired
    protected AppUserRepository users;

    @Autowired
    protected PatientRepository patients;

    @Autowired
    protected DoctorGrantRepository grants;

    @Autowired
    protected ConsentRecordRepository consents;

    @Autowired
    protected PasswordEncoder encoder;

    /** A client address nobody else in the test run has used. */
    protected static String freshIp() {
        int n = NEXT_IP.getAndIncrement();
        return "10." + ((n >> 16) & 255) + "." + ((n >> 8) & 255) + "." + (n & 255);
    }

    protected static RequestPostProcessor from(String ip) {
        return (MockHttpServletRequest request) -> {
            request.setRemoteAddr(ip);
            return request;
        };
    }

    protected AppUser newUser(Role role, Status status) {
        AppUser u = new AppUser();
        u.setEmail("u" + UUID.randomUUID().toString().substring(0, 12) + "@example.com");
        u.setName(role.name().charAt(0) + role.name().substring(1).toLowerCase() + " Tester");
        u.setPasswordHash(encoder.encode(PASSWORD));
        u.setRole(role);
        u.setStatus(status);
        return users.save(u);
    }

    protected AppUser newUser(Role role) {
        return newUser(role, Status.ACTIVE);
    }

    protected Patient newPatient(AppUser owner) {
        Patient p = new Patient();
        p.setName("Synthetic Patient " + UUID.randomUUID().toString().substring(0, 6));
        p.setKinshipTerm("Aaita");
        p.setCaregiverId(owner.getId());
        p = patients.save(p);
        ConsentRecord c = new ConsentRecord();
        c.setPatientId(p.getId());
        c.setGivenBy(owner.getId());
        c.setNoticeVersion("test");
        consents.save(c);
        return p;
    }

    protected DoctorGrant grantTo(Patient patient, AppUser doctor, AppUser by, long days) {
        DoctorGrant g = new DoctorGrant();
        g.setPatientId(patient.getId());
        g.setDoctorUserId(doctor.getId());
        g.setGrantedBy(by.getId());
        g.setExpiresAt(Instant.now().plus(days, ChronoUnit.DAYS));
        return grants.save(g);
    }

    /** What a sign-in handed back: the access token, and the refresh cookie if any. */
    public record Signed(String accessToken, String refreshCookie, MvcResult result) {
    }

    protected Signed loginFull(String email, String password, String ip) throws Exception {
        MvcResult r = mvc.perform(post("/api/auth/login")
                        .with(from(ip))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json.writeValueAsString(java.util.Map.of("email", email, "password", password))))
                .andReturn();
        return signed(r);
    }

    protected Signed signed(MvcResult r) throws Exception {
        String token = null;
        if (r.getResponse().getStatus() / 100 == 2 && !r.getResponse().getContentAsString().isBlank()) {
            JsonNode body = json.readTree(r.getResponse().getContentAsString());
            token = body.has("accessToken") ? body.get("accessToken").asText()
                    : body.path("session").path("accessToken").asText(null);
        }
        Cookie cookie = r.getResponse().getCookie("smaran_rt");
        return new Signed(token, cookie == null || cookie.getValue().isEmpty() ? null : cookie.getValue(), r);
    }

    /** Signs a user in through the real endpoint and returns the access token. */
    protected String tokenFor(AppUser user) throws Exception {
        Signed s = loginFull(user.getEmail(), PASSWORD, freshIp());
        if (s.accessToken() == null) {
            throw new AssertionError("sign-in failed for " + user.getRole() + ": HTTP " + s.result().getResponse().getStatus());
        }
        return s.accessToken();
    }

    protected static String bearer(String token) {
        return "Bearer " + token;
    }

    /** Pairs a tablet to a patient through the real endpoints and returns its device token. */
    protected String deviceTokenFor(String ownerToken, String patientId) throws Exception {
        MvcResult issued = mvc.perform(post("/api/patients/" + patientId + "/pairing-codes")
                        .header("Authorization", bearer(ownerToken)))
                .andExpect(status().isOk())
                .andReturn();
        String code = json.readTree(issued.getResponse().getContentAsString()).get("code").asText();
        MvcResult redeemed = mvc.perform(post("/api/pairing/redeem")
                        .with(from(freshIp()))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json.writeValueAsString(java.util.Map.of(
                                "code", code, "deviceLabel", "test tablet", "deviceFingerprint", UUID.randomUUID().toString()))))
                .andExpect(status().isOk())
                .andReturn();
        return json.readTree(redeemed.getResponse().getContentAsString()).get("deviceToken").asText();
    }
}
