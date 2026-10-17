package org.smaran;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.JsonNode;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.smaran.domain.Enums.Role;
import org.smaran.support.ApiTest;

/** The description of the API: generated from the code, for an administrator, and nobody else. */
class OpenApiIT extends ApiTest {

    @Test
    @DisplayName("only an administrator can read the API description")
    void adminOnly() throws Exception {
        mvc.perform(get("/v3/api-docs")).andExpect(status().isUnauthorized());
        for (Role role : new Role[] {Role.CAREGIVER, Role.DOCTOR}) {
            mvc.perform(get("/v3/api-docs").header("Authorization", bearer(tokenFor(newUser(role)))))
                    .andExpect(status().isForbidden());
        }
        mvc.perform(get("/v3/api-docs.yaml").header("Authorization", bearer(tokenFor(newUser(Role.CAREGIVER)))))
                .andExpect(status().isForbidden());
    }

    @Test
    @DisplayName("it describes the real API: the paths, the bearer token, and what the data is")
    void describesTheApi() throws Exception {
        String body = mvc.perform(get("/v3/api-docs").header("Authorization", bearer(tokenFor(newUser(Role.ADMIN)))))
                .andExpect(status().isOk()).andReturn().getResponse().getContentAsString();
        JsonNode doc = json.readTree(body);

        assertTrue(doc.get("openapi").asText().startsWith("3."), doc.get("openapi").asText());
        assertEquals("Smaran API", doc.at("/info/title").asText());
        assertTrue(doc.at("/info/description").asText().contains("synthetic"), "it must say the demonstration data is synthetic");
        assertEquals("bearer", doc.at("/components/securitySchemes/bearerAuth/scheme").asText());

        JsonNode paths = doc.get("paths");
        for (String p : new String[] {
            "/api/auth/login", "/api/pairing/redeem", "/api/device/sessions/batch", "/api/patients",
            "/api/caregiver/dashboard/{patientId}"}) {
            assertTrue(paths.has(p), "missing " + p);
        }
        assertTrue(paths.size() >= 40, "only " + paths.size() + " paths: is a controller missing?");
        paths.fieldNames().forEachRemaining(p ->
                assertFalse(p.startsWith("/actuator"), "the actuator is not part of the product's API: " + p));
    }
}
