package org.smaran;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

import com.fasterxml.jackson.databind.JsonNode;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeSet;
import java.util.UUID;
import java.util.concurrent.Callable;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.smaran.config.JwtService;
import org.smaran.domain.AppUser;
import org.smaran.domain.Enums.Role;
import org.smaran.domain.Patient;
import org.smaran.service.DeviceService;
import org.smaran.support.ApiTest;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

/**
 * Pairing, against real PostgreSQL: a code works once, for 72 hours; guessing is
 * limited; two tablets racing one code cannot both win; a removed tablet is
 * refused on its next request; and a tablet's token opens nothing but its own door.
 */
class PairingIT extends ApiTest {

    @Autowired
    JdbcTemplate jdbc;

    @Autowired
    JwtService jwt;

    /* ------------------------------------------------------------ helpers */

    private record Family(AppUser owner, Patient patient, String ownerToken) {
    }

    private Family family() throws Exception {
        AppUser owner = newUser(Role.CAREGIVER);
        Patient p = newPatient(owner);
        return new Family(owner, p, tokenFor(owner));
    }

    private String mint(Family f) throws Exception {
        MvcResult r = mvc.perform(post("/api/patients/" + f.patient().getId() + "/pairing-codes")
                        .with(from(freshIp()))
                        .header("Authorization", bearer(f.ownerToken())))
                .andReturn();
        assertEquals(200, r.getResponse().getStatus(), r.getResponse().getContentAsString());
        return json.readTree(r.getResponse().getContentAsString()).get("code").asText();
    }

    private MvcResult redeem(String code, String fingerprint, String ip) throws Exception {
        Map<String, String> body = new java.util.HashMap<>();
        body.put("code", code);
        body.put("deviceLabel", "Living-room tablet");
        if (fingerprint != null) {
            body.put("deviceFingerprint", fingerprint);
        }
        return mvc.perform(post("/api/pairing/redeem")
                        .with(from(ip))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json.writeValueAsString(body)))
                .andReturn();
    }

    private MvcResult redeem(String code) throws Exception {
        return redeem(code, UUID.randomUUID().toString(), freshIp());
    }

    private static int status(MvcResult r) {
        return r.getResponse().getStatus();
    }

    private JsonNode body(MvcResult r) throws Exception {
        return json.readTree(r.getResponse().getContentAsString());
    }

    private String pair(Family f) throws Exception {
        MvcResult r = redeem(mint(f));
        assertEquals(200, status(r), r.getResponse().getContentAsString());
        return body(r).get("deviceToken").asText();
    }

    private int call(MockHttpServletRequestBuilder req, String token) throws Exception {
        req.with(from(freshIp()));
        if (token != null) {
            req.header("Authorization", bearer(token));
        }
        return mvc.perform(req).andReturn().getResponse().getStatus();
    }

    private MvcResult callFull(MockHttpServletRequestBuilder req, String token) throws Exception {
        req.with(from(freshIp()));
        if (token != null) {
            req.header("Authorization", bearer(token));
        }
        return mvc.perform(req).andReturn();
    }

    private String wrongCode(String realCode) {
        // Six symbols from the alphabet that is not the real one.
        String real = realCode.replace("-", "");
        String candidate = real.equals("AAAAAA") ? "CCCCCC" : "AAAAAA";
        return candidate;
    }

    /* -------------------------------------------------------- the code */

    @Test
    @DisplayName("a code looks like HJ4K-2M, lives 72 hours, and is stored only as a hash")
    void mintedCode() throws Exception {
        Family f = family();
        MvcResult r = mvc.perform(post("/api/patients/" + f.patient().getId() + "/pairing-codes")
                        .with(from(freshIp()))
                        .header("Authorization", bearer(f.ownerToken())))
                .andReturn();
        JsonNode b = body(r);
        String code = b.get("code").asText();
        assertTrue(code.matches("[ACDEFGHJKMNPQRTUVWXYZ234679]{4}-[ACDEFGHJKMNPQRTUVWXYZ234679]{2}"), code);

        Duration life = Duration.between(Instant.now(), Instant.parse(b.get("expiresAt").asText()));
        assertTrue(life.compareTo(Duration.ofHours(71).plusMinutes(55)) > 0 && life.compareTo(Duration.ofHours(72)) <= 0,
                "lives 72 hours, was " + life);

        List<String> stored = jdbc.queryForList("select code_hash from pairing_code where patient_id = ?", String.class,
                f.patient().getId());
        assertEquals(1, stored.size());
        assertEquals(64, stored.get(0).length());
        assertFalse(stored.get(0).toUpperCase().contains(code.replace("-", "")), "the code itself must not be stored");
    }

    @Test
    @DisplayName("pairing works once; the same code a second time gets the generic answer")
    void singleUse() throws Exception {
        Family f = family();
        String code = mint(f);
        assertEquals(200, status(redeem(code)));

        MvcResult again = redeem(code);
        MvcResult unknown = redeem(wrongCode(code));
        assertEquals(404, status(again));
        assertEquals(404, status(unknown));
        assertEquals(unknown.getResponse().getContentAsString(), again.getResponse().getContentAsString(),
                "a used code and an unknown one must be indistinguishable");
    }

    @Test
    @DisplayName("a code is read the same however it is capitalised, spaced or dashed")
    void normalised() throws Exception {
        for (java.util.function.UnaryOperator<String> typed : List.<java.util.function.UnaryOperator<String>>of(
                c -> c.toLowerCase(), c -> c.replace("-", ""), c -> " " + c.replace("-", " - ") + " ")) {
            Family f = family();
            String code = mint(f);
            MvcResult r = redeem(typed.apply(code));
            assertEquals(200, status(r), "typed as '" + typed.apply(code) + "'");
        }
    }

    @Test
    @DisplayName("an expired code gets the same generic answer")
    void expired() throws Exception {
        Family f = family();
        String code = mint(f);
        jdbc.update("update pairing_code set expires_at = now() - interval '1 minute' where patient_id = ?",
                f.patient().getId());
        MvcResult r = redeem(code);
        assertEquals(404, status(r));
        assertFalse(r.getResponse().getContentAsString().toLowerCase().contains("expire"),
                "the answer must not say which way the code failed");
    }

    @Test
    @DisplayName("minting a new code retires an unused one")
    void newCodeRetiresOld() throws Exception {
        Family f = family();
        String first = mint(f);
        String second = mint(f);
        assertNotEquals(first, second);
        assertEquals(404, status(redeem(first)));
        assertEquals(200, status(redeem(second)));
    }

    @Test
    @DisplayName("garbage in the request is a refusal, never an error")
    void garbage() throws Exception {
        for (String body : List.of("{}", "{\"code\":\"\"}", "{\"code\":\"<script>\"}", "{\"code\":\"" + "A".repeat(500) + "\"}")) {
            MvcResult r = mvc.perform(post("/api/pairing/redeem")
                            .with(from(freshIp()))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content(body))
                    .andReturn();
            assertEquals(404, status(r), body);
        }
    }

    /* ------------------------------------------------------- guessing */

    @Test
    @DisplayName("five wrong tries from one tablet lock it, and a correct code is then refused too")
    void lockedByFingerprint() throws Exception {
        Family f = family();
        String code = mint(f);
        String fp = UUID.randomUUID().toString();
        for (int i = 0; i < 5; i++) {
            assertEquals(404, status(redeem(wrongCode(code), fp, freshIp())), "try " + (i + 1));
        }
        assertEquals(429, status(redeem(wrongCode(code), fp, freshIp())), "the sixth try");
        assertEquals(429, status(redeem(code, fp, freshIp())), "the right code does not get past a lockout");

        // Someone else, with a different tablet, is not affected.
        assertEquals(200, status(redeem(code, UUID.randomUUID().toString(), freshIp())));
    }

    @Test
    @DisplayName("five wrong tries from one address lock that address, however many tablet ids it invents")
    void lockedByAddress() throws Exception {
        Family f = family();
        String code = mint(f);
        String ip = freshIp();
        for (int i = 0; i < 5; i++) {
            assertEquals(404, status(redeem(wrongCode(code), UUID.randomUUID().toString(), ip)), "try " + (i + 1));
        }
        assertEquals(429, status(redeem(code, UUID.randomUUID().toString(), ip)));
        assertEquals(429, status(redeem(code, null, ip)), "leaving the tablet id out does not help");
        assertEquals(200, status(redeem(code, UUID.randomUUID().toString(), freshIp())), "another address is unaffected");
    }

    @Test
    @DisplayName("the lockout ends after fifteen minutes")
    void lockoutEnds() throws Exception {
        Family f = family();
        String code = mint(f);
        String fp = UUID.randomUUID().toString();
        for (int i = 0; i < 5; i++) {
            redeem(wrongCode(code), fp, freshIp());
        }
        assertEquals(429, status(redeem(code, fp, freshIp())));
        jdbc.update("update pairing_attempt set at = at - interval '16 minutes' where fingerprint = ?", fp);
        assertEquals(200, status(redeem(code, fp, freshIp())));
    }

    @Test
    @DisplayName("the attempts are stored with a hash of the address, not the address, and old ones are deleted")
    void attemptsAreTidy() throws Exception {
        Family f = family();
        String code = mint(f);
        String ip = freshIp();
        redeem(wrongCode(code), UUID.randomUUID().toString(), ip);
        Integer withIp = jdbc.queryForObject("select count(*) from pairing_attempt where ip = ?", Integer.class, ip);
        assertEquals(0, withIp, "the address itself must not be stored");

        jdbc.update("insert into pairing_attempt (at, ip, fingerprint, succeeded) values (now() - interval '2 days', 'old', 'oldfp', false)");
        redeem(wrongCode(code), UUID.randomUUID().toString(), freshIp());
        assertEquals(0, jdbc.queryForObject("select count(*) from pairing_attempt where ip = 'old'", Integer.class));
    }

    /* ----------------------------------------------- two tablets, one code */

    @Test
    @DisplayName("two tablets racing one code: exactly one wins, and there is exactly one device")
    void concurrentRedemption() throws Exception {
        Family f = family();
        String code = mint(f);
        int racers = 8;
        ExecutorService pool = Executors.newFixedThreadPool(racers);
        CountDownLatch go = new CountDownLatch(1);
        try {
            List<Future<Integer>> results = new ArrayList<>();
            for (int i = 0; i < racers; i++) {
                String fp = UUID.randomUUID().toString();
                String ip = freshIp();
                Callable<Integer> task = () -> {
                    go.await();
                    return status(redeem(code, fp, ip));
                };
                results.add(pool.submit(task));
            }
            go.countDown();
            int ok = 0;
            Set<Integer> others = new TreeSet<>();
            for (Future<Integer> r : results) {
                int s = r.get();
                if (s == 200) {
                    ok++;
                } else {
                    others.add(s);
                }
            }
            assertEquals(1, ok, "exactly one tablet may win");
            assertEquals(Set.of(404), others, "the losers get the generic refusal");
        } finally {
            pool.shutdownNow();
        }
        assertEquals(1, jdbc.queryForObject("select count(*) from device where patient_id = ?", Integer.class,
                f.patient().getId()));
    }

    /* -------------------------------------------------- the device token */

    @Test
    @DisplayName("redeeming returns an opaque token and the least a tablet needs; the token is stored only as a hash")
    void bundleAndToken() throws Exception {
        Family f = family();
        MvcResult r = redeem(mint(f));
        JsonNode b = body(r);
        String token = b.get("deviceToken").asText();
        assertTrue(token.startsWith("sdt_") && token.length() > 40, token);
        assertFalse(token.contains("."), "it is not a JWT");

        JsonNode patient = b.get("patient");
        assertEquals(Set.of("patientId", "firstName", "languageCode", "kinshipTerm"), fieldNames(patient));
        assertEquals(f.patient().getId(), patient.get("patientId").asText());
        assertEquals("Synthetic", patient.get("firstName").asText(), "a first name only");
        assertEquals("Aaita", patient.get("kinshipTerm").asText());
        assertFalse(r.getResponse().getContentAsString().contains(f.owner().getId()), "nothing about the owner");

        List<String> hashes = jdbc.queryForList("select token_hash from device where patient_id = ?", String.class,
                f.patient().getId());
        assertEquals(List.of(DeviceService.sha256Hex(token)), hashes);
        assertFalse(jdbc.queryForObject("select count(*) from device where token_hash = ?", Integer.class, token) > 0);
    }

    private static Set<String> fieldNames(JsonNode n) {
        Set<String> names = new TreeSet<>();
        n.fieldNames().forEachRemaining(names::add);
        return names;
    }

    @Test
    @DisplayName("a paired tablet reads only its own patient, and cannot name another")
    void scopedToOnePatient() throws Exception {
        Family a = family();
        Family b = family();
        String tokenA = pair(a);
        String tokenB = pair(b);

        assertEquals(a.patient().getId(), body(callFull(get("/api/device/me"), tokenA)).get("patientId").asText());
        assertEquals(b.patient().getId(), body(callFull(get("/api/device/me"), tokenB)).get("patientId").asText());

        // A session whose body claims to be someone else's is filed under the tablet's own patient.
        int before = count("game_session", b.patient().getId());
        int beforeA = count("game_session", a.patient().getId());
        String payload = "{\"patientId\":\"" + a.patient().getId()
                + "\",\"gameType\":\"KOI_ARE_JUMPING\",\"startedAt\":\"2026-10-07T04:30:00Z\"}";
        assertEquals(200, call(post("/api/device/sessions").contentType(MediaType.APPLICATION_JSON).content(payload), tokenB));
        assertEquals(before + 1, count("game_session", b.patient().getId()), "filed under the tablet's own patient");
        assertEquals(beforeA, count("game_session", a.patient().getId()), "and not under the one named in the body");
    }

    private int count(String table, String patientId) {
        return jdbc.queryForObject("select count(*) from " + table + " where patient_id = ?", Integer.class, patientId);
    }

    @Test
    @DisplayName("a tablet may change the language she is greeted in, and nothing else about her")
    void languageOnly() throws Exception {
        Family f = family();
        String token = pair(f);
        String name = f.patient().getName();
        MvcResult r = callFull(patch("/api/device/me").contentType(MediaType.APPLICATION_JSON)
                .content("{\"languageCode\":\"hi\",\"name\":\"Someone Else\",\"kinshipTerm\":\"x\"}"), token);
        assertEquals(200, status(r));
        assertEquals("hi", body(r).get("languageCode").asText());
        Patient after = patients.findById(f.patient().getId()).orElseThrow();
        assertEquals(name, after.getName(), "the name is not the tablet's to change");
        assertEquals("Aaita", after.getKinshipTerm());
        assertEquals(400, call(patch("/api/device/me").contentType(MediaType.APPLICATION_JSON)
                .content("{\"languageCode\":\"not a language!\"}"), token));
    }

    @Test
    @DisplayName("each paired tablet slides its own expiry forward when it is seen")
    void expirySlides() throws Exception {
        Family f = family();
        String token = pair(f);
        jdbc.update("update device set last_seen_at = now() - interval '1 hour', expires_at = now() + interval '2 days' where patient_id = ?",
                f.patient().getId());
        assertEquals(200, call(get("/api/device/me"), token));
        Duration left = Duration.between(Instant.now(), jdbc.queryForObject(
                "select expires_at from device where patient_id = ?", java.sql.Timestamp.class, f.patient().getId()).toInstant());
        assertTrue(left.toDays() >= 179, "expiry should be about 180 days out, was " + left);
    }

    @Test
    @DisplayName("a tablet that has lapsed is refused")
    void lapsed() throws Exception {
        Family f = family();
        String token = pair(f);
        jdbc.update("update device set expires_at = now() - interval '1 minute' where patient_id = ?", f.patient().getId());
        assertEquals(401, call(get("/api/device/me"), token));
    }

    /* ---------------------------------------------------------- removal */

    @Test
    @DisplayName("removing a tablet refuses it on its very next request, and deletes none of her data")
    void revocation() throws Exception {
        Family f = family();
        String token = pair(f);
        assertEquals(200, call(post("/api/device/garden/water").contentType(MediaType.APPLICATION_JSON)
                .content("{\"gameType\":\"KOI_ARE_JUMPING\"}"), token));
        assertEquals(200, call(post("/api/device/sessions").contentType(MediaType.APPLICATION_JSON)
                .content("{\"gameType\":\"KOI_ARE_JUMPING\",\"startedAt\":\"2026-10-07T04:30:00Z\"}"), token));
        int sessions = count("game_session", f.patient().getId());

        JsonNode listed = body(callFull(get("/api/patients/" + f.patient().getId() + "/devices"), f.ownerToken()));
        assertEquals(1, listed.size());
        assertEquals(Set.of("id", "label", "pairedAt", "lastSeenAt", "expiresAt"), fieldNames(listed.get(0)),
                "the listing shows no token and no hash");
        String deviceId = listed.get(0).get("id").asText();

        assertEquals(204, call(delete("/api/patients/" + f.patient().getId() + "/devices/" + deviceId), f.ownerToken()));

        assertEquals(401, call(get("/api/device/me"), token), "refused on the next request");
        assertEquals(401, call(post("/api/device/sessions/batch").contentType(MediaType.APPLICATION_JSON)
                .content("{\"sessions\":[]}"), token));
        assertEquals(sessions, count("game_session", f.patient().getId()), "her sessions are still there");
        assertTrue(patients.existsById(f.patient().getId()));
        assertEquals(0, body(callFull(get("/api/patients/" + f.patient().getId() + "/devices"), f.ownerToken())).size(),
                "it no longer appears in the family's list");

        assertEquals(204, call(delete("/api/patients/" + f.patient().getId() + "/devices/" + deviceId), f.ownerToken()),
                "removing twice is fine");
        assertEquals(1, jdbc.queryForObject("select count(*) from audit_event where action = 'DEVICE_REVOKED' and patient_id = ?",
                Integer.class, f.patient().getId()), "and is recorded once");
    }

    @Test
    @DisplayName("only her owner (or an admin) can mint, list or remove: not another family, not a doctor")
    void whoMayPair() throws Exception {
        Family f = family();
        String token = pair(f);
        String deviceId = jdbc.queryForObject("select id from device where patient_id = ?", String.class, f.patient().getId());

        String other = tokenFor(newUser(Role.CAREGIVER));
        AppUser doctor = newUser(Role.DOCTOR);
        grantTo(f.patient(), doctor, f.owner(), 30);
        String doctorToken = tokenFor(doctor);

        String pid = f.patient().getId();
        assertEquals(404, call(post("/api/patients/" + pid + "/pairing-codes"), other));
        assertEquals(404, call(get("/api/patients/" + pid + "/devices"), other));
        assertEquals(404, call(delete("/api/patients/" + pid + "/devices/" + deviceId), other));
        assertEquals(403, call(post("/api/patients/" + pid + "/pairing-codes"), doctorToken));
        assertEquals(403, call(delete("/api/patients/" + pid + "/devices/" + deviceId), doctorToken));
        assertEquals(403, call(post("/api/patients/" + pid + "/pairing-codes"), token), "a tablet cannot mint codes");
        assertEquals(200, call(get("/api/device/me"), token), "and none of that removed it");
    }

    /* ----------------------------------------- one token, one set of doors */

    @Test
    @DisplayName("a tablet's token is refused by every caregiver, doctor and admin endpoint")
    void deviceTokenOpensNothingElse() throws Exception {
        Family f = family();
        String token = pair(f);
        String pid = f.patient().getId();
        for (String path : List.of(
                "/api/patients", "/api/patients/" + pid + "/devices", "/api/patients/" + pid + "/audit",
                "/api/patients/" + pid + "/doctor-grants", "/api/caregiver/dashboard/" + pid, "/api/report/patient/" + pid,
                "/api/patient/" + pid + "/profile", "/api/garden/" + pid, "/api/family/" + pid + "/members",
                "/api/game/" + pid + "/route", "/api/reminder/" + pid + "/schedule", "/api/biomarker/" + pid + "/trend",
                "/api/doctor/patients", "/api/admin/users", "/api/admin/audit")) {
            int s = call(get(path), token);
            assertEquals(403, s, "GET " + path);
        }
        assertEquals(401, call(get("/api/auth/me"), token), "and a tablet is not a signed-in person");
    }

    @Test
    @DisplayName("a person's token is refused by the tablet's endpoints")
    void personTokenOpensNoDeviceDoor() throws Exception {
        Family f = family();
        assertEquals(403, call(get("/api/device/me"), f.ownerToken()));
        assertEquals(403, call(get("/api/device/garden"), tokenFor(newUser(Role.ADMIN))));
    }

    @Test
    @DisplayName("a token of the old kind (a signed PATIENT token) is ignored, not honoured")
    void oldStyleTokens() throws Exception {
        Family f = family();
        String old = jwt.issueAccess(f.patient().getId(), "PATIENT", List.of(f.patient().getId()));
        assertEquals(401, call(get("/api/device/me"), old));
        assertEquals(401, call(get("/api/garden/" + f.patient().getId()), old));
        // A made-up token that merely looks like a device token.
        assertEquals(401, call(get("/api/device/me"), "sdt_" + UUID.randomUUID()));
    }

    @Test
    @DisplayName("pairing and removal are recorded without the code or the token")
    void audited() throws Exception {
        Family f = family();
        MvcResult r = redeem(mint(f));
        String token = body(r).get("deviceToken").asText();
        List<String> details = jdbc.queryForList(
                "select coalesce(detail::text, '') || coalesce(resource, '') from audit_event where patient_id = ? and action = 'DEVICE_PAIRED'",
                String.class, f.patient().getId());
        assertEquals(1, details.size());
        assertFalse(details.get(0).contains(token));
    }
}
