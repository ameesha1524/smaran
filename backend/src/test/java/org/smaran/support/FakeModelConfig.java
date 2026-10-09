package org.smaran.support;

import java.util.Optional;
import org.smaran.journal.ModelClient;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Primary;

/** A language model that answers what the test tells it to, and remembers what it was asked. */
@TestConfiguration
public class FakeModelConfig {

    public static class Fake implements ModelClient {
        public volatile Optional<String> answer = Optional.empty();
        public volatile String lastSystem;
        public volatile String lastUser;
        public volatile int calls;

        @Override
        public Optional<String> complete(String system, String user) {
            calls++;
            lastSystem = system;
            lastUser = user;
            return answer;
        }

        @Override
        public String modelName() {
            return "fake-model";
        }

        public void answer(String json) {
            this.answer = Optional.of(json);
        }
    }

    @Bean
    @Primary
    public Fake fakeModel() {
        return new Fake();
    }
}
