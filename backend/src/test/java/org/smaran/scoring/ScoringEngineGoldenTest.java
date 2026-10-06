package org.smaran.scoring;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.stream.Stream;
import org.junit.jupiter.api.DynamicTest;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestFactory;
import org.smaran.scoring.Contract.Reading;
import org.smaran.scoring.Contract.ScoreContribution;
import org.smaran.scoring.Contract.TargetState;

/**
 * Holds the Java engine to golden-vectors.json, the file the TypeScript engine
 * generates. Every case is replayed step by step and must give the same
 * readings and the same final state.
 *
 * If this fails after a deliberate rule change: the TypeScript engine was
 * changed and {@code npm run golden} was run, and this engine now has to make
 * the same change.
 */
class ScoringEngineGoldenTest {

    /** Numbers must agree to within floating-point noise, not merely look alike. */
    private static final double EPS = 1e-9;

    static final ObjectMapper JSON = new ObjectMapper();

    static JsonNode golden() throws Exception {
        // Maven runs tests from backend/; the file sits at the repo root.
        Path file = Path.of("..", "golden-vectors.json");
        assertTrue(Files.exists(file), "golden-vectors.json not found at " + file.toAbsolutePath());
        return JSON.readTree(Files.readString(file));
    }

    @Test
    void theFileHasCases() throws Exception {
        assertTrue(golden().get("cases").size() >= 12);
    }

    @TestFactory
    Stream<DynamicTest> everyCaseReplaysIdentically() throws Exception {
        JsonNode file = golden();
        List<DynamicTest> tests = new ArrayList<>();
        for (JsonNode testCase : file.get("cases")) {
            tests.add(DynamicTest.dynamicTest(testCase.get("name").asText(), () -> replay(file, testCase)));
        }
        return tests.stream();
    }

    private void replay(JsonNode file, JsonNode testCase) throws Exception {
        // The case's overrides on top of the file's default config.
        ObjectNode merged = file.get("config").deepCopy();
        merged.setAll((ObjectNode) testCase.get("config"));
        ScoringConfig config = JSON.treeToValue(merged, ScoringConfig.class);

        Map<String, TargetState> state = new LinkedHashMap<>(JSON.convertValue(
                testCase.get("initial"), new TypeReference<LinkedHashMap<String, TargetState>>() {
                }));
        List<Reading> readings = new ArrayList<>();
        for (JsonNode c : testCase.get("contributions")) {
            ScoreContribution contribution = new ScoreContribution(
                    c.get("target").asText(), c.get("raw").asDouble(), c.get("confidence").asDouble(), "");
            ScoringEngine.SessionResult out = ScoringEngine.applySession(state, List.of(contribution), config);
            state = out.state();
            readings.addAll(out.readings());
        }

        JsonNode expected = testCase.get("expected");
        assertEquals(expected.size(), readings.size(), "number of readings");
        for (int i = 0; i < readings.size(); i++) {
            Reading got = readings.get(i);
            JsonNode want = expected.get(i);
            String at = "step " + i + " ";
            assertEquals(want.get("target").asText(), got.target(), at + "target");
            assertEquals(want.get("status").asText(), got.status().label(), at + "status");
            assertEquals(
                    want.get("alert").isNull() ? null : want.get("alert").asText(),
                    got.alert() == null ? null : got.alert().label(),
                    at + "alert");
            assertEquals(want.get("raw").asDouble(), got.raw(), EPS, at + "raw");
            assertEquals(want.get("confidence").asDouble(), got.confidence(), EPS, at + "confidence");
            assertEquals(want.get("level").asDouble(), got.level(), EPS, at + "level");
            assertEquals(want.get("baseline").asDouble(), got.baseline(), EPS, at + "baseline");
            assertEquals(want.get("sd").asDouble(), got.sd(), EPS, at + "sd");
            assertEquals(want.get("velocity").asDouble(), got.velocity(), EPS, at + "velocity");
            assertEquals(want.get("domainConfidence").asDouble(), got.domainConfidence(), EPS, at + "domainConfidence");
        }

        Map<String, TargetState> wantState = JSON.convertValue(
                testCase.get("finalState"), new TypeReference<LinkedHashMap<String, TargetState>>() {
                });
        assertEquals(wantState.keySet(), state.keySet(), "targets in final state");
        for (Map.Entry<String, TargetState> e : wantState.entrySet()) {
            TargetState want = e.getValue();
            TargetState got = state.get(e.getKey());
            assertNotNull(got);
            assertEquals(want.level(), got.level(), EPS, e.getKey() + " level");
            assertEquals(want.observations(), got.observations(), e.getKey() + " observations");
            assertEquals(want.runWatch(), got.runWatch(), e.getKey() + " runWatch");
            assertEquals(want.runDecline(), got.runDecline(), e.getKey() + " runDecline");
            assertEquals(want.cusum(), got.cusum(), EPS, e.getKey() + " cusum");
            assertEquals(want.raws().size(), got.raws().size(), e.getKey() + " raws kept");
            for (int i = 0; i < want.raws().size(); i++) {
                assertEquals(want.raws().get(i), got.raws().get(i), EPS, e.getKey() + " raw " + i);
            }
        }
    }
}
