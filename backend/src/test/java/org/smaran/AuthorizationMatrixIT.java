package org.smaran;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.ArrayList;
import java.util.EnumMap;
import java.util.List;
import java.util.Map;
import java.util.stream.Stream;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.DynamicTest;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestFactory;
import org.junit.jupiter.api.TestInstance;
import org.smaran.domain.AppUser;
import org.smaran.domain.Enums.Role;
import org.smaran.domain.Patient;
import org.smaran.support.ApiTest;
import org.springframework.http.HttpMethod;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders;

/**
 * Who may call what: every endpoint, as every kind of caller, one assertion
 * each. This is the test oracle for docs/MASTER_PROMPT.md Appendix B.
 *
 * Each endpoint belongs to one group, and each group says what every caller
 * should get. A caller who must be refused gets an exact status code. A caller
 * who is allowed gets anything except 401, 403 or 404, because what the
 * endpoint then does with a body that is deliberately empty is not this test's
 * business.
 *
 * <pre>
 *   401  not signed in
 *   403  signed in, but this kind of user may never do this
 *   404  allowed to do this to some patient, but not this one (or none exists)
 * </pre>
 */
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
class AuthorizationMatrixIT extends ApiTest {

    /** The callers. "Owner" owns patient P; "other" owns a different patient Q. */
    enum Who {
        ANONYMOUS, OWNER, OTHER_CAREGIVER, DOCTOR_WITH_GRANT, DOCTOR_NO_GRANT, ADMIN, DEVICE_OF_P, DEVICE_OF_Q
    }

    /** Expected outcome: a code that must be returned exactly, or "allowed". */
    static final int OK = 0;

    /** What each group of endpoints expects from each caller. */
    static final Map<String, Map<Who, Integer>> GROUPS = Map.of(
            // Set the patient up and manage her access.
            "CAREGIVE", table(401, OK, 404, 403, 403, OK, 403, 403),
            // What her tablet does, and her family on her behalf.
            "PLAY", table(401, OK, 404, 403, 403, OK, OK, 404),
            // Read the dashboard and the report: the one thing a doctor may do.
            "CLINICAL_READ", table(401, OK, 404, OK, 404, OK, 403, 403),
            // A caregiver's own list and their patient creation.
            "CAREGIVER_ONLY", table(401, OK, OK, 403, 403, 403, 403, 403),
            "ADMIN_ONLY", table(401, 403, 403, 403, 403, OK, 403, 403),
            "DOCTOR_ONLY", table(401, 403, 403, OK, OK, 403, 403, 403),
            // Any signed-in person, but a tablet is not a person.
            "PERSON_ONLY", table(401, OK, OK, OK, OK, OK, 401, 401));

    private static Map<Who, Integer> table(int... expected) {
        Map<Who, Integer> m = new EnumMap<>(Who.class);
        for (int i = 0; i < expected.length; i++) {
            m.put(Who.values()[i], expected[i]);
        }
        return m;
    }

    record Endpoint(String group, HttpMethod method, String path, String body) {
        String label() {
            return method + " " + path;
        }
    }

    private AppUser owner;
    private AppUser doctor;
    private Patient p;
    private Patient q;
    private final Map<Who, String> tokens = new EnumMap<>(Who.class);

    @org.junit.jupiter.api.BeforeAll
    void setUp() throws Exception {
        owner = newUser(Role.CAREGIVER);
        AppUser other = newUser(Role.CAREGIVER);
        doctor = newUser(Role.DOCTOR);
        AppUser noGrant = newUser(Role.DOCTOR);
        AppUser admin = newUser(Role.ADMIN);
        p = newPatient(owner);
        q = newPatient(other);
        grantTo(p, doctor, owner, 30);

        tokens.put(Who.OWNER, tokenFor(owner));
        tokens.put(Who.OTHER_CAREGIVER, tokenFor(other));
        tokens.put(Who.DOCTOR_WITH_GRANT, tokenFor(doctor));
        tokens.put(Who.DOCTOR_NO_GRANT, tokenFor(noGrant));
        tokens.put(Who.ADMIN, tokenFor(admin));
        tokens.put(Who.DEVICE_OF_P, deviceTokenFor(tokens.get(Who.OWNER), p.getId()));
        tokens.put(Who.DEVICE_OF_Q, deviceTokenFor(tokens.get(Who.OTHER_CAREGIVER), q.getId()));
    }

    /** Every endpoint that takes a patient, or that gates on role. {p} is the patient under test. */
    private List<Endpoint> endpoints() {
        String pid = "\"patientId\":\"{p}\"";
        List<Endpoint> e = new ArrayList<>();

        // CAREGIVE
        e.add(new Endpoint("CAREGIVE", HttpMethod.POST, "/api/patients/{p}/pairing-codes", null));
        e.add(new Endpoint("CAREGIVE", HttpMethod.GET, "/api/patients/{p}/devices", null));
        e.add(new Endpoint("CAREGIVE", HttpMethod.POST, "/api/patients/{p}/doctor-grants",
                "{\"doctorEmail\":\"" + doctor.getEmail() + "\",\"days\":30}"));
        e.add(new Endpoint("CAREGIVE", HttpMethod.GET, "/api/patients/{p}/doctor-grants", null));
        e.add(new Endpoint("CAREGIVE", HttpMethod.GET, "/api/patients/{p}/audit", null));
        e.add(new Endpoint("CAREGIVE", HttpMethod.PATCH, "/api/patient/{p}/profile", "{}"));
        e.add(new Endpoint("CAREGIVE", HttpMethod.PUT, "/api/patient/{p}/objects", "[]"));
        e.add(new Endpoint("CAREGIVE", HttpMethod.PUT, "/api/reminder/{p}/schedule", "[]"));
        e.add(new Endpoint("CAREGIVE", HttpMethod.POST, "/api/reminder/trigger", "{" + pid + "}"));

        // PLAY
        e.add(new Endpoint("PLAY", HttpMethod.GET, "/api/patient/{p}/profile", null));
        e.add(new Endpoint("PLAY", HttpMethod.GET, "/api/patient/{p}/objects", null));
        e.add(new Endpoint("PLAY", HttpMethod.POST, "/api/patient/{p}/mood", "{\"mood\":\"QUIET\",\"localHour\":9}"));
        e.add(new Endpoint("PLAY", HttpMethod.POST, "/api/session", "{" + pid + ",\"gameType\":\"KOI_ARE_JUMPING\",\"startedAt\":\"2026-10-07T04:30:00Z\"}"));
        e.add(new Endpoint("PLAY", HttpMethod.POST, "/api/sync/sessions", "{" + pid + ",\"sessions\":[],\"vectors\":[]}"));
        e.add(new Endpoint("PLAY", HttpMethod.POST, "/api/biomarker/vector", "{" + pid + "}"));
        e.add(new Endpoint("PLAY", HttpMethod.POST, "/api/cognitive/sample", "{\"sessionId\":\"{p}:KOI_ARE_JUMPING:1\"}"));
        e.add(new Endpoint("PLAY", HttpMethod.GET, "/api/game/{p}/route", null));
        e.add(new Endpoint("PLAY", HttpMethod.GET, "/api/garden/{p}", null));
        e.add(new Endpoint("PLAY", HttpMethod.POST, "/api/garden/{p}/water", "{\"gameType\":\"KOI_ARE_JUMPING\"}"));
        e.add(new Endpoint("PLAY", HttpMethod.GET, "/api/family/{p}/members", null));
        e.add(new Endpoint("PLAY", HttpMethod.GET, "/api/reminder/{p}/schedule", null));

        // CLINICAL_READ
        e.add(new Endpoint("CLINICAL_READ", HttpMethod.GET, "/api/caregiver/dashboard/{p}", null));
        e.add(new Endpoint("CLINICAL_READ", HttpMethod.GET, "/api/report/patient/{p}", null));
        e.add(new Endpoint("CLINICAL_READ", HttpMethod.GET, "/api/biomarker/{p}/trend", null));

        // Role-only endpoints: no patient in the path.
        e.add(new Endpoint("CAREGIVER_ONLY", HttpMethod.GET, "/api/patients", null));
        e.add(new Endpoint("CAREGIVER_ONLY", HttpMethod.POST, "/api/patients", "{\"name\":\"x\"}"));
        e.add(new Endpoint("ADMIN_ONLY", HttpMethod.GET, "/api/admin/users", null));
        e.add(new Endpoint("ADMIN_ONLY", HttpMethod.GET, "/api/admin/audit", null));
        e.add(new Endpoint("DOCTOR_ONLY", HttpMethod.GET, "/api/doctor/patients", null));
        e.add(new Endpoint("PERSON_ONLY", HttpMethod.GET, "/api/auth/me", null));
        return e;
    }

    @TestFactory
    @DisplayName("every endpoint, as every caller")
    Stream<DynamicTest> matrix() {
        List<DynamicTest> tests = new ArrayList<>();
        for (Endpoint endpoint : endpoints()) {
            for (Who who : Who.values()) {
                int expected = GROUPS.get(endpoint.group()).get(who);
                tests.add(DynamicTest.dynamicTest(
                        "%-15s %-18s %s".formatted(endpoint.group(), who, endpoint.label()),
                        () -> check(endpoint, who, expected)));
            }
        }
        return tests.stream();
    }

    private void check(Endpoint endpoint, Who who, int expected) throws Exception {
        // Device Q is a tablet of a different patient: for every patient URL it is
        // asking about P, which is not hers.
        String path = endpoint.path().replace("{p}", p.getId());
        String body = endpoint.body() == null ? null : endpoint.body().replace("{p}", p.getId());

        MockHttpServletRequestBuilder req = MockMvcRequestBuilders.request(endpoint.method(), path).with(from(freshIp()));
        if (body != null) {
            req.contentType(MediaType.APPLICATION_JSON).content(body);
        }
        String token = tokens.get(who);
        if (token != null) {
            req.header("Authorization", bearer(token));
        }

        int got = mvc.perform(req).andReturn().getResponse().getStatus();
        String what = endpoint.label() + " as " + who;
        if (expected == OK) {
            assertFalse(got == 401 || got == 403 || got == 404,
                    what + " should be allowed but was refused with " + got);
        } else {
            assertEquals(expected, got, what);
        }
    }

    @Test
    @DisplayName("the matrix covers every kind of caller and every group")
    void matrixIsComplete() {
        for (Map<Who, Integer> row : GROUPS.values()) {
            assertEquals(Who.values().length, row.size());
        }
        long groups = endpoints().stream().map(Endpoint::group).distinct().count();
        assertEquals(GROUPS.size(), groups, "a group is defined but has no endpoint, or the reverse");
        assertTrue(endpoints().size() >= 25, "the matrix should cover every patient endpoint");
    }
}
