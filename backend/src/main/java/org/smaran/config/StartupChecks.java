package org.smaran.config;

import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.ApplicationListener;
import org.springframework.core.env.Environment;
import org.springframework.stereotype.Component;

/**
 * Two things that must never quietly be true in production.
 *
 * Both are the kind of setting that is fine on a laptop and catastrophic on a
 * server holding a dementia patient's mood history, so neither is allowed to be
 * a warning buried in a log at startup. The placeholder secret refuses to boot;
 * the open API shouts on every start.
 */
@Component
@Slf4j
public class StartupChecks implements ApplicationListener<ApplicationReadyEvent> {

    private static final String PLACEHOLDER_SECRET = "change-me-change-me-change-me-change-me-32b";

    private final String jwtSecret;
    private final boolean openDemo;
    private final Environment environment;

    public StartupChecks(
            @Value("${smaran.security.jwt-secret}") String jwtSecret,
            @Value("${smaran.security.open-demo:false}") boolean openDemo,
            Environment environment) {
        this.jwtSecret = jwtSecret;
        this.openDemo = openDemo;
        this.environment = environment;
    }

    @Override
    public void onApplicationEvent(ApplicationReadyEvent event) {
        boolean dev = environment.matchesProfiles("dev");

        if (!dev && PLACEHOLDER_SECRET.equals(jwtSecret)) {
            throw new IllegalStateException(
                    "SMARAN_JWT_SECRET is still the placeholder. Set a real 32-byte secret before starting "
                            + "outside the dev profile — every caregiver session depends on it.");
        }

        if (openDemo) {
            log.warn("""

                    ***********************************************************
                     smaran.security.open-demo is ON — the API is unauthenticated.
                     This is for demos and local development only. If this server
                     holds a real patient's data, stop it now.
                    ***********************************************************
                    """);
        }
    }
}
