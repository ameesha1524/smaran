package org.smaran.config;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.mock.env.MockEnvironment;

/** What may not start. Anything that is not dev, demo or test is production. */
class StartupChecksTest {

    private static final String REAL = "k7Qp2vX9mZ4cR8tN1bL6wE3yH5uJ0aSdFgVhCxBn";

    private static StartupChecks checks(String secret, boolean openDemo, String... profiles) {
        MockEnvironment env = new MockEnvironment();
        env.setActiveProfiles(profiles);
        return new StartupChecks(secret, openDemo, env);
    }

    @Test
    @DisplayName("prod with a real secret starts")
    void prodOk() {
        checks(REAL, false, "prod").afterPropertiesSet();
    }

    @Test
    @DisplayName("prod with no secret, a short one, or a built-in one refuses to start")
    void prodBadSecret() {
        assertThrows(IllegalStateException.class, () -> checks("", false, "prod").afterPropertiesSet());
        assertThrows(IllegalStateException.class, () -> checks(null, false, "prod").afterPropertiesSet());
        assertThrows(IllegalStateException.class, () -> checks("too-short", false, "prod").afterPropertiesSet());
        for (String known : StartupChecks.KNOWN_SECRETS) {
            assertThrows(IllegalStateException.class, () -> checks(known, false, "prod").afterPropertiesSet());
        }
    }

    @Test
    @DisplayName("prod with the API open refuses to start")
    void prodOpenDemo() {
        assertThrows(IllegalStateException.class, () -> checks(REAL, true, "prod").afterPropertiesSet());
    }

    @Test
    @DisplayName("no profile at all is treated as production")
    void noProfile() {
        assertThrows(IllegalStateException.class, () -> checks("", false).afterPropertiesSet());
        assertThrows(IllegalStateException.class, () -> checks(REAL, true).afterPropertiesSet());
    }

    @Test
    @DisplayName("adding dev beside prod does not relax anything")
    void devCannotMaskProd() {
        assertThrows(IllegalStateException.class, () -> checks("", false, "prod", "dev").afterPropertiesSet());
    }

    @Test
    @DisplayName("dev, demo and test may use their built-in secrets")
    void relaxedProfiles() {
        checks("dev-only-secret-dev-only-secret-dev-only-32", true, "dev").afterPropertiesSet();
        checks("demo-only-secret-demo-only-secret-demo-32", false, "demo").afterPropertiesSet();
        checks("test-only-secret-test-only-secret-test-32", false, "test").afterPropertiesSet();
    }

    @Test
    @DisplayName("the refusal never repeats the secret")
    void messageHidesSecret() {
        String problem = StartupChecks.problem("too-short", false, false);
        assertNotNull(problem);
        assertFalse(problem.contains("too-short"));
        assertNull(StartupChecks.problem(REAL, false, false));
    }
}
