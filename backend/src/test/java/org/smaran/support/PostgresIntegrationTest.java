package org.smaran.support;

import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

/**
 * Base class for tests that need the whole application on a real PostgreSQL.
 *
 * Flyway runs every migration against an empty database and Hibernate then
 * validates the entities against the result, so simply starting the context is
 * already a test that the migrations and the entities agree.
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
public abstract class PostgresIntegrationTest {

    @DynamicPropertySource
    static void database(DynamicPropertyRegistry registry) {
        TestPostgres.Connection db = TestPostgres.get();
        registry.add("spring.datasource.url", db::url);
        registry.add("spring.datasource.username", db::username);
        registry.add("spring.datasource.password", db::password);
    }
}
