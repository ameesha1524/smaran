package org.smaran.scoring;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.annotation.JsonValue;
import java.util.Arrays;
import java.util.List;
import java.util.Map;
import java.util.stream.Stream;

/**
 * The shared contract between a game, the device, the server and the
 * data-science code (docs/MASTER_PROMPT.md, Appendix A).
 *
 * Mirror of frontend/src/lib/scoring/types.ts. The ids and field names here are
 * checked against golden-vectors.json by ContractTest, as the TypeScript copy
 * is by its own test, so neither side can drift without a test failing.
 */
public final class Contract {

    private Contract() {
    }

    public static final String ENGINE_VERSION = "1.0.0";

    public enum DomainId {
        LANGUAGE, VISUAL_SEMANTIC, MOTOR, AFFECTIVE, TEMPORAL, EXECUTIVE
    }

    public enum SubSignalId {
        WORKING_MEMORY_SPAN,
        INHIBITORY_CONTROL,
        COGNITIVE_FLEXIBILITY,
        TRAJECTORY_PREDICTION,
        REACTION_SPEED,
        SUSTAINED_ATTENTION
    }

    /** Every id a contribution may target: the six domains, then the sub-signals. */
    public static final List<String> TARGET_IDS = Stream.concat(
                    Arrays.stream(DomainId.values()).map(Enum::name),
                    Arrays.stream(SubSignalId.values()).map(Enum::name))
            .toList();

    public enum Status {
        STABLE, WATCH, DECLINE, IMPROVING;

        @JsonValue
        public String label() {
            return name().toLowerCase();
        }

        @JsonCreator
        public static Status of(String label) {
            return valueOf(label.toUpperCase());
        }
    }

    public enum AlertSeverity {
        WATCH, DECLINE;

        @JsonValue
        public String label() {
            return name().toLowerCase();
        }

        @JsonCreator
        public static AlertSeverity of(String label) {
            return label == null ? null : valueOf(label.toUpperCase());
        }
    }

    public enum AlertRule {
        TWO_CONSECUTIVE, SINGLE, CUSUM
    }

    /** What one session says about one domain or sub-signal. */
    public record ScoreContribution(String target, double raw, double confidence, String because) {
    }

    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record SessionMarkers(
            Double workingMemorySpan, Double inhibitionBreakdownTier, Double trajectoryPrecisionMs) {
    }

    public record Difficulty(int tier, Map<String, Object> params) {
    }

    /** One finished sitting, as it travels from the tablet to the server. */
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record SessionEnvelope(
            String clientSessionId,
            String patientId,
            String gameId,
            String startedAt,
            long durationMs,
            boolean completed,
            boolean abandoned,
            int hourOfDay,
            String moodAtStart,
            Difficulty difficulty,
            List<Object> trials,
            List<ScoreContribution> contributions,
            SessionMarkers markers,
            Boolean precomputedReading,
            String engineVersion) {
    }

    /** Everything the engine remembers about one domain or sub-signal. */
    public record TargetState(
            double level, int observations, List<Double> raws, int runWatch, int runDecline, double cusum) {
    }

    /** What applying one contribution produced. */
    public record Reading(
            String target,
            double raw,
            double confidence,
            double level,
            double baseline,
            double sd,
            double velocity,
            double domainConfidence,
            Status status,
            AlertSeverity alert) {
    }
}
