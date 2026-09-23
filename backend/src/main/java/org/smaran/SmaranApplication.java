package org.smaran;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.scheduling.annotation.EnableScheduling;

/**
 * Smaran — backend.
 *
 * Serves the patient PWA, the caregiver dashboard and the doctor's reports.
 * Three things about this service are load-bearing and worth stating here:
 *
 *   1. It is optional. Every game, every reminder and every animation runs on
 *      the device with the radio off; this service reconciles, aggregates and
 *      notifies. Nothing here may become a dependency of her being able to play.
 *   2. It never receives raw voice or video. Only acoustic feature vectors and
 *      aggregate landmark-derived load scores arrive, which is what makes the
 *      DPDP Act 2023 story architectural rather than procedural.
 *   3. Its arithmetic for the garden and the routing mirrors the device's
 *      exactly (GardenStateService ↔ gardenEngine.ts, CognitiveProfileService ↔
 *      cognitiveProfile.ts). When you change one, change the other.
 */
@SpringBootApplication
@EnableScheduling
public class SmaranApplication {

    public static void main(String[] args) {
        SpringApplication.run(SmaranApplication.class, args);
    }
}
