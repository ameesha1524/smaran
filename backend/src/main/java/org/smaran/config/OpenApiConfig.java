package org.smaran.config;

import io.swagger.v3.oas.models.Components;
import io.swagger.v3.oas.models.OpenAPI;
import io.swagger.v3.oas.models.info.Info;
import io.swagger.v3.oas.models.security.SecurityRequirement;
import io.swagger.v3.oas.models.security.SecurityScheme;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.boot.info.BuildProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * What the generated API description says about the API as a whole. The paths and the schemas come from the
 * controllers and the DTO records; this adds the title, how a caller proves who they are, and the pointers a
 * reader needs and cannot get from a path list: who may call what (the authorization matrix) and what the
 * data is.
 *
 * Served at {@code /v3/api-docs} to an administrator in every profile but prod, where it is switched off
 * (application.yml).
 */
@Configuration
public class OpenApiConfig {

    static final String BEARER = "bearerAuth";

    @Bean
    public OpenAPI smaranOpenApi(ObjectProvider<BuildProperties> build) {
        BuildProperties props = build.getIfAvailable();
        return new OpenAPI()
                .info(new Info()
                        .title("Smaran API")
                        .version(props != null ? props.getVersion() : "dev")
                        .description("""
                                The API behind Smaran, a companion for people living with dementia, and the dashboards their \
                                families and clinicians read.

                                **Who may call what** is decided on the server, per patient, on every request, and the table of \
                                it is `docs/rbac-architecture.md`; the tests that hold it are `AuthorizationMatrixIT`. A request \
                                for a patient the caller may not see is a 404, never a 403, so that the answer does not reveal \
                                whether the patient exists.

                                **Callers**: a family member or caregiver, a doctor, an administrator (each signs in at \
                                `/api/auth/login` and sends the access token as a bearer token), and a paired tablet \
                                (`/api/device/**`, with the device token it got by redeeming a pairing code).

                                **The data in a demonstration is synthetic.** Smaran is not a medical device and has not been \
                                clinically validated; nothing here diagnoses anything."""))
                .components(new Components().addSecuritySchemes(BEARER, new SecurityScheme()
                        .type(SecurityScheme.Type.HTTP)
                        .scheme("bearer")
                        .bearerFormat("JWT")))
                .addSecurityItem(new SecurityRequirement().addList(BEARER));
    }
}
