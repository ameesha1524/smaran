package org.smaran;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.Map;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.smaran.domain.Enums.Role;
import org.smaran.domain.Patient;
import org.smaran.service.SessionIngestionService;
import org.smaran.support.ApiTest;
import org.smaran.support.Envelopes;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MvcResult;

/** What an operator can see: health, build, the counters the specification names, and who may read them. */
class ObservabilityIT extends ApiTest {

    @Autowired
    SessionIngestionService ingestion;

    private String metrics(String token) throws Exception {
        MvcResult r = mvc.perform(get("/actuator/prometheus").header("Authorization", bearer(token)))
                .andExpect(status().isOk()).andReturn();
        return r.getResponse().getContentAsString();
    }

    private static double value(String text, String prefix) {
        return text.lines().filter(l -> l.startsWith(prefix)).mapToDouble(l -> Double.parseDouble(l.substring(l.lastIndexOf(' ') + 1)))
                .sum();
    }

    @Test
    @DisplayName("health and info are public and say little; every response carries a request id")
    void healthAndInfo() throws Exception {
        MvcResult health = mvc.perform(get("/actuator/health")).andExpect(status().isOk()).andReturn();
        assertEquals("{\"status\":\"UP\"}", health.getResponse().getContentAsString());
        assertTrue(health.getResponse().getHeader("X-Request-Id").length() >= 8);
        mvc.perform(get("/actuator/info")).andExpect(status().isOk());
        mvc.perform(get("/actuator/env")).andExpect(status().isUnauthorized());
        mvc.perform(get("/actuator/prometheus")).andExpect(status().isUnauthorized());
        mvc.perform(get("/actuator/prometheus").header("Authorization", bearer(tokenFor(newUser(Role.CAREGIVER)))))
                .andExpect(status().isForbidden());
        mvc.perform(get("/actuator/prometheus").header("Authorization", bearer(tokenFor(newUser(Role.DOCTOR)))))
                .andExpect(status().isForbidden());
    }

    @Test
    @DisplayName("a request id the caller supplies is echoed, and a hostile one is not")
    void requestIdEcho() throws Exception {
        MvcResult ok = mvc.perform(get("/actuator/health").header("X-Request-Id", "caddy-abc-12345")).andReturn();
        assertEquals("caddy-abc-12345", ok.getResponse().getHeader("X-Request-Id"));
        MvcResult bad = mvc.perform(get("/actuator/health").header("X-Request-Id", "x y")).andReturn();
        assertTrue(bad.getResponse().getHeader("X-Request-Id").matches("[0-9a-f-]{36}"));
    }

    @Test
    @DisplayName("failed sign-ins, wrong pairing codes and ingested sessions are counted, and an administrator can read them")
    void counters() throws Exception {
        String admin = tokenFor(newUser(Role.ADMIN));
        String before = metrics(admin);

        mvc.perform(post("/api/auth/login").with(from(freshIp())).contentType(MediaType.APPLICATION_JSON)
                .content(json.writeValueAsString(Map.of("email", "nobody@example.com", "password", "nope-nope-nope"))))
                .andExpect(status().isUnauthorized());
        mvc.perform(post("/api/pairing/redeem").with(from(freshIp())).contentType(MediaType.APPLICATION_JSON)
                .content(json.writeValueAsString(Map.of("code", "AAAAAA", "label", "x", "fingerprint", "fp-observability"))))
                .andExpect(status().isNotFound());
        Patient p = newPatient(newUser(Role.CAREGIVER));
        Instant at = Instant.now().minus(2, ChronoUnit.HOURS).truncatedTo(ChronoUnit.MILLIS);
        var e = Envelopes.koi(p.getId(), at, 70);
        assertEquals(SessionIngestionService.Status.ACCEPTED, ingestion.ingestBatch(p.getId(), null, java.util.List.of(e))
                .outcomes().get(0).status());
        ingestion.ingestBatch(p.getId(), null, java.util.List.of(e));

        String after = metrics(admin);
        assertEquals(value(before, "auth_failures_total") + 1, value(after, "auth_failures_total"));
        assertEquals(value(before, "pairing_failures_total{") + 1, value(after, "pairing_failures_total{"));
        assertEquals(value(before, "sessions_ingested_total{application=\"smaran\",status=\"accepted\"")
                + 1, value(after, "sessions_ingested_total{application=\"smaran\",status=\"accepted\""));
        assertEquals(value(before, "sessions_ingested_total{application=\"smaran\",status=\"duplicate\"")
                + 1, value(after, "sessions_ingested_total{application=\"smaran\",status=\"duplicate\""));
        assertTrue(after.contains("scoring_mismatch_total"), "the scoring mismatch counter is exported");
        assertTrue(after.contains("jvm_memory_used_bytes"), "the standard JVM metrics are there");
    }
}
