package org.smaran;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.smaran.domain.AppUser;
import org.smaran.domain.AppUser.Status;
import org.smaran.domain.DoctorGrant;
import org.smaran.domain.Enums.Role;
import org.smaran.domain.Patient;
import org.smaran.support.ApiTest;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.web.servlet.MvcResult;

/** Doctor grants and their expiry, doctor read-only access, patient creation with consent, and the audit trail. */
class GrantsAndAuditIT extends ApiTest {

    @Autowired
    JdbcTemplate jdbc;

    private int status(String method, String path, String token) throws Exception {
        var req = switch (method) {
            case "GET" -> get(path);
            case "POST" -> post(path).contentType(MediaType.APPLICATION_JSON).content("{}");
            default -> delete(path);
        };
        req.with(from(freshIp()));
        if (token != null) {
            req.header("Authorization", bearer(token));
        }
        return mvc.perform(req).andReturn().getResponse().getStatus();
    }

    private int auditCount(String action, String actorId, String patientId) {
        return jdbc.queryForObject(
                "select count(*) from audit_event where action = ? and actor_id = ? and patient_id = ?",
                Integer.class, action, actorId, patientId);
    }

    /* ---------------------------------------------------------- creating */

    @Test
    @DisplayName("a patient is created only with the guardian's consent, which is recorded")
    void consentIsRequired() throws Exception {
        AppUser cg = newUser(Role.CAREGIVER);
        String token = tokenFor(cg);

        MvcResult refused = mvc.perform(post("/api/patients").header("Authorization", bearer(token))
                .contentType(MediaType.APPLICATION_JSON)
                .content(json.writeValueAsString(Map.of("name", "Anima", "guardianConsent", false)))).andReturn();
        assertEquals(400, refused.getResponse().getStatus());
        assertEquals(0, patients.findByCaregiverId(cg.getId()).size(), "nothing was created without consent");

        MvcResult created = mvc.perform(post("/api/patients").header("Authorization", bearer(token))
                .contentType(MediaType.APPLICATION_JSON)
                .content(json.writeValueAsString(Map.of(
                        "name", "Anima", "guardianConsent", true, "guardianName", "Rupa", "noticeVersion", "2026-10"))))
                .andReturn();
        assertEquals(201, created.getResponse().getStatus());
        String id = json.readTree(created.getResponse().getContentAsString()).get("id").asText();

        assertEquals(cg.getId(), patients.findById(id).orElseThrow().getCaregiverId());
        assertTrue(consents.existsByPatientId(id));
        assertEquals(1, auditCount("PATIENT_CREATED", cg.getId(), id));
        assertEquals(200, status("GET", "/api/caregiver/dashboard/" + id, token));
    }

    @Test
    @DisplayName("a caregiver lists only their own patients")
    void listsOnlyOwn() throws Exception {
        AppUser a = newUser(Role.CAREGIVER);
        AppUser b = newUser(Role.CAREGIVER);
        Patient pa = newPatient(a);
        Patient pb = newPatient(b);
        String body = mvc.perform(get("/api/patients").header("Authorization", bearer(tokenFor(a))))
                .andReturn().getResponse().getContentAsString();
        assertTrue(body.contains(pa.getId()));
        assertFalse(body.contains(pb.getId()));
    }

    /* ------------------------------------------------------------ grants */

    @Test
    @DisplayName("a doctor sees a patient only after a grant, and loses her the moment it is revoked")
    void grantLifecycle() throws Exception {
        AppUser cg = newUser(Role.CAREGIVER);
        AppUser doc = newUser(Role.DOCTOR);
        Patient p = newPatient(cg);
        String cgToken = tokenFor(cg);
        String docToken = tokenFor(doc);

        assertEquals(404, status("GET", "/api/caregiver/dashboard/" + p.getId(), docToken), "no grant yet");
        assertEquals("[]", mvc.perform(get("/api/doctor/patients").header("Authorization", bearer(docToken)))
                .andReturn().getResponse().getContentAsString());

        MvcResult granted = mvc.perform(post("/api/patients/" + p.getId() + "/doctor-grants")
                .header("Authorization", bearer(cgToken)).contentType(MediaType.APPLICATION_JSON)
                .content(json.writeValueAsString(Map.of("doctorEmail", doc.getEmail().toUpperCase(), "days", 14)))).andReturn();
        assertEquals(201, granted.getResponse().getStatus());
        JsonNode grant = json.readTree(granted.getResponse().getContentAsString());
        assertTrue(grant.get("live").asBoolean());

        assertEquals(200, status("GET", "/api/caregiver/dashboard/" + p.getId(), docToken));
        assertEquals(200, status("GET", "/api/report/patient/" + p.getId(), docToken));
        String listed = mvc.perform(get("/api/doctor/patients").header("Authorization", bearer(docToken)))
                .andReturn().getResponse().getContentAsString();
        assertTrue(listed.contains(p.getId()) && listed.contains("sharedUntil"), listed);

        assertEquals(204, status("DELETE", "/api/patients/" + p.getId() + "/doctor-grants/" + grant.get("id").asText(), cgToken));
        assertEquals(404, status("GET", "/api/caregiver/dashboard/" + p.getId(), docToken), "revoked: gone on the next request");
        assertEquals(1, auditCount("GRANT_CREATED", cg.getId(), p.getId()));
        assertEquals(1, auditCount("GRANT_REVOKED", cg.getId(), p.getId()));
    }

    @Test
    @DisplayName("an expired grant stops working immediately, without anyone revoking it")
    void expiredGrant() throws Exception {
        AppUser cg = newUser(Role.CAREGIVER);
        AppUser doc = newUser(Role.DOCTOR);
        Patient p = newPatient(cg);
        DoctorGrant g = grantTo(p, doc, cg, 30);
        String docToken = tokenFor(doc);
        assertEquals(200, status("GET", "/api/caregiver/dashboard/" + p.getId(), docToken));

        jdbc.update("update doctor_grant set expires_at = now() - interval '1 second' where id = ?", g.getId());
        assertEquals(404, status("GET", "/api/caregiver/dashboard/" + p.getId(), docToken));
        assertEquals("[]", mvc.perform(get("/api/doctor/patients").header("Authorization", bearer(docToken)))
                .andReturn().getResponse().getContentAsString());
    }

    @Test
    @DisplayName("granting again replaces the earlier grant instead of stacking another")
    void regrantReplaces() throws Exception {
        AppUser cg = newUser(Role.CAREGIVER);
        AppUser doc = newUser(Role.DOCTOR);
        Patient p = newPatient(cg);
        String cgToken = tokenFor(cg);
        for (int i = 0; i < 3; i++) {
            assertEquals(201, mvc.perform(post("/api/patients/" + p.getId() + "/doctor-grants")
                    .header("Authorization", bearer(cgToken)).contentType(MediaType.APPLICATION_JSON)
                    .content(json.writeValueAsString(Map.of("doctorEmail", doc.getEmail())))).andReturn().getResponse().getStatus());
        }
        Integer live = jdbc.queryForObject(
                "select count(*) from doctor_grant where patient_id = ? and revoked_at is null", Integer.class, p.getId());
        assertEquals(1, live);
        assertEquals(3, grants.findByPatientIdOrderByGrantedAtDesc(p.getId()).size(), "history is kept");
    }

    @Test
    @DisplayName("grants are refused for a non-doctor, an unapproved doctor, a bad length, and by a non-owner")
    void grantRefusals() throws Exception {
        AppUser cg = newUser(Role.CAREGIVER);
        Patient p = newPatient(cg);
        String cgToken = tokenFor(cg);
        String url = "/api/patients/" + p.getId() + "/doctor-grants";

        for (AppUser target : List.of(newUser(Role.CAREGIVER), newUser(Role.DOCTOR, Status.PENDING), newUser(Role.DOCTOR, Status.DISABLED))) {
            assertEquals(404, mvc.perform(post(url).header("Authorization", bearer(cgToken)).contentType(MediaType.APPLICATION_JSON)
                    .content(json.writeValueAsString(Map.of("doctorEmail", target.getEmail())))).andReturn().getResponse().getStatus());
        }
        AppUser doc = newUser(Role.DOCTOR);
        for (int days : new int[] {0, -5, 366}) {
            assertEquals(400, mvc.perform(post(url).header("Authorization", bearer(cgToken)).contentType(MediaType.APPLICATION_JSON)
                    .content(json.writeValueAsString(Map.of("doctorEmail", doc.getEmail(), "days", days)))).andReturn().getResponse().getStatus());
        }
        // Another caregiver cannot grant on a patient that is not theirs.
        assertEquals(404, mvc.perform(post(url).header("Authorization", bearer(tokenFor(newUser(Role.CAREGIVER))))
                .contentType(MediaType.APPLICATION_JSON)
                .content(json.writeValueAsString(Map.of("doctorEmail", doc.getEmail())))).andReturn().getResponse().getStatus());
    }

    @Test
    @DisplayName("a grant to one patient does not open another, and a doctor cannot do anything but read")
    void doctorIsReadOnlyAndScoped() throws Exception {
        AppUser cg = newUser(Role.CAREGIVER);
        AppUser doc = newUser(Role.DOCTOR);
        Patient shared = newPatient(cg);
        Patient notShared = newPatient(cg);
        grantTo(shared, doc, cg, 30);
        String docToken = tokenFor(doc);

        assertEquals(200, status("GET", "/api/caregiver/dashboard/" + shared.getId(), docToken));
        assertEquals(404, status("GET", "/api/caregiver/dashboard/" + notShared.getId(), docToken));

        // Everything that is not the dashboard, report or trend is closed to her, shared patient or not.
        for (String path : List.of("/api/patient/%s/profile", "/api/patient/%s/objects", "/api/family/%s/members",
                "/api/garden/%s", "/api/game/%s/route", "/api/reminder/%s/schedule", "/api/patients/%s/devices",
                "/api/patients/%s/audit", "/api/patients/%s/doctor-grants")) {
            assertEquals(403, status("GET", path.formatted(shared.getId()), docToken), path);
        }
        assertEquals(403, status("POST", "/api/patients/" + shared.getId() + "/pairing-codes", docToken));
        assertEquals(403, status("POST", "/api/session", docToken));
    }

    /* -------------------------------------------------------------- audit */

    @Test
    @DisplayName("reads and refused attempts are both recorded, and the caregiver can read their patient's trail")
    void auditTrail() throws Exception {
        AppUser cg = newUser(Role.CAREGIVER);
        AppUser doc = newUser(Role.DOCTOR);
        AppUser intruder = newUser(Role.CAREGIVER);
        Patient p = newPatient(cg);
        grantTo(p, doc, cg, 30);
        String cgToken = tokenFor(cg);

        status("GET", "/api/caregiver/dashboard/" + p.getId(), cgToken);
        status("GET", "/api/caregiver/dashboard/" + p.getId(), tokenFor(doc));
        status("GET", "/api/caregiver/dashboard/" + p.getId(), tokenFor(intruder));

        assertEquals(1, auditCount("PATIENT_READ", cg.getId(), p.getId()));
        assertEquals(1, auditCount("PATIENT_READ", doc.getId(), p.getId()));
        assertEquals(1, auditCount("ACCESS_DENIED", intruder.getId(), p.getId()));

        JsonNode trail = json.readTree(mvc.perform(get("/api/patients/" + p.getId() + "/audit")
                .header("Authorization", bearer(cgToken))).andReturn().getResponse().getContentAsString());
        String text = trail.toString();
        assertTrue(text.contains(doc.getId()), "the owner sees that the doctor looked");
        assertTrue(text.contains(intruder.getId()), "and that a stranger tried");
        assertTrue(text.contains("/api/caregiver/dashboard/" + p.getId()));
        assertFalse(text.contains(PASSWORD), "no secret ever lands in the trail");

        // The intruder cannot read the owner's trail, nor can the doctor.
        assertEquals(404, status("GET", "/api/patients/" + p.getId() + "/audit", tokenFor(intruder)));
        assertEquals(403, status("GET", "/api/patients/" + p.getId() + "/audit", tokenFor(doc)));
    }

    @Test
    @DisplayName("an admin's access to a patient is audited, and a tablet's routine requests are not")
    void adminAuditedDeviceNot() throws Exception {
        AppUser cg = newUser(Role.CAREGIVER);
        AppUser admin = newUser(Role.ADMIN);
        Patient p = newPatient(cg);
        String adminToken = tokenFor(admin);

        status("GET", "/api/caregiver/dashboard/" + p.getId(), adminToken);
        assertEquals(1, auditCount("PATIENT_READ", admin.getId(), p.getId()));

        String device = deviceTokenFor(tokenFor(cg), p.getId());
        int before = jdbc.queryForObject("select count(*) from audit_event where patient_id = ?", Integer.class, p.getId());
        status("GET", "/api/patient/" + p.getId() + "/profile", device);
        status("GET", "/api/garden/" + p.getId(), device);
        int after = jdbc.queryForObject("select count(*) from audit_event where patient_id = ?", Integer.class, p.getId());
        assertEquals(before, after, "the tablet's routine reads are not audited");
    }

    @Test
    @DisplayName("sign-ins and failures are recorded without the password")
    void loginsAudited() throws Exception {
        AppUser cg = newUser(Role.CAREGIVER);
        loginFull(cg.getEmail(), "wrong-password-xyz", freshIp());
        loginFull(cg.getEmail(), PASSWORD, freshIp());
        List<String> details = jdbc.queryForList(
                "select coalesce(detail::text, '') from audit_event where actor_id = ? and action like 'LOGIN%'", String.class, cg.getId());
        assertEquals(2, details.size());
        for (String d : details) {
            assertFalse(d.contains("wrong-password-xyz") || d.contains(PASSWORD), d);
        }
        assertNotNull(details);
    }

    @Test
    @DisplayName("only an admin can read the whole audit log")
    void wholeLogIsAdminOnly() throws Exception {
        assertEquals(403, status("GET", "/api/admin/audit", tokenFor(newUser(Role.CAREGIVER))));
        assertEquals(403, status("GET", "/api/admin/audit", tokenFor(newUser(Role.DOCTOR))));
        assertEquals(200, status("GET", "/api/admin/audit", tokenFor(newUser(Role.ADMIN))));
        assertEquals(401, status("GET", "/api/admin/audit", null));
    }
}
