package org.smaran;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.smaran.domain.Enums.Role;
import org.smaran.support.ApiTest;
import org.springframework.test.context.TestPropertySource;

/**
 * The prod profile sets {@code springdoc.api-docs.enabled=false} (application.yml). This is the same setting, so
 * that what an administrator can read in development is not there, even for an administrator, in production.
 */
@TestPropertySource(properties = "springdoc.api-docs.enabled=false")
class OpenApiOffIT extends ApiTest {

    @Test
    @DisplayName("with the setting prod uses, the API description is not served, even to an administrator")
    void notServed() throws Exception {
        mvc.perform(get("/v3/api-docs").header("Authorization", bearer(tokenFor(newUser(Role.ADMIN)))))
                .andExpect(status().isNotFound());
        mvc.perform(get("/v3/api-docs.yaml").header("Authorization", bearer(tokenFor(newUser(Role.ADMIN)))))
                .andExpect(status().isNotFound());
    }
}
