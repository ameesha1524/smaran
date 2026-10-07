package org.smaran.config;

import java.nio.charset.StandardCharsets;
import java.util.Set;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.InitializingBean;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.env.Environment;
import org.springframework.core.env.Profiles;
import org.springframework.stereotype.Component;

/**
 * Things that must never quietly be true on a real server.
 *
 * Each is fine on a laptop and catastrophic on a machine holding a dementia
 * patient's history, so none is allowed to be a warning buried in a log. The
 * application refuses to start instead.
 *
 * The `dev`, `demo` and `test` profiles are the only ones allowed a built-in
 * secret, an open API or seeded accounts. Every other profile — `prod`, a
 * profile nobody has thought of yet, or no profile at all — is treated as
 * production. Runs while the context is still being built, before the web
 * server accepts a single request.
 */
@Component
@Slf4j
public class StartupChecks implements InitializingBean {

    static final int MIN_SECRET_BYTES = 32;

    /** Secrets that exist in this repository and so are not secrets. */
    static final Set<String> KNOWN_SECRETS = Set.of(
            "change-me-change-me-change-me-change-me-32b",
            "dev-only-secret-dev-only-secret-dev-only-32",
            "demo-only-secret-demo-only-secret-demo-32",
            "test-only-secret-test-only-secret-test-32");

    private final String jwtSecret;
    private final boolean openDemo;
    private final boolean relaxed;

    public StartupChecks(
            @Value("${smaran.security.jwt-secret:}") String jwtSecret,
            @Value("${smaran.security.open-demo:false}") boolean openDemo,
            Environment environment) {
        this.jwtSecret = jwtSecret;
        this.openDemo = openDemo;
        this.relaxed = environment.acceptsProfiles(Profiles.of("dev", "demo", "test"))
                && !environment.acceptsProfiles(Profiles.of("prod"));
    }

    @Override
    public void afterPropertiesSet() {
        String problem = problem(jwtSecret, openDemo, relaxed);
        if (problem != null) {
            throw new IllegalStateException(problem);
        }
        if (openDemo) {
            log.warn("""

                    ***********************************************************
                     smaran.security.open-demo is ON — the API is unauthenticated.
                     This is for local development only. If this server holds a
                     real person's data, stop it now.
                    ***********************************************************
                    """);
        }
    }

    /** Why this configuration may not start, or null if it may. Never includes the secret itself. */
    static String problem(String jwtSecret, boolean openDemo, boolean relaxed) {
        if (relaxed) {
            return null;
        }
        if (jwtSecret == null || jwtSecret.isBlank()) {
            return "SMARAN_JWT_SECRET is not set. Outside the dev, demo and test profiles a secret of at least "
                    + MIN_SECRET_BYTES + " bytes is required.";
        }
        if (KNOWN_SECRETS.contains(jwtSecret)) {
            return "SMARAN_JWT_SECRET is one of the built-in development values. Set a real secret before starting "
                    + "outside the dev, demo and test profiles.";
        }
        int bytes = jwtSecret.getBytes(StandardCharsets.UTF_8).length;
        if (bytes < MIN_SECRET_BYTES) {
            return "SMARAN_JWT_SECRET is " + bytes + " bytes; at least " + MIN_SECRET_BYTES + " are required.";
        }
        if (openDemo) {
            return "smaran.security.open-demo is on. An unauthenticated API is only allowed in the dev profile.";
        }
        return null;
    }
}
