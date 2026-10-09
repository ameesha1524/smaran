package org.smaran.scoring;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.stream.Stream;
import org.junit.jupiter.api.DynamicTest;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestFactory;
import org.smaran.scoring.Contract.ScoreContribution;

/**
 * Holds the Java Duck Roll Call scoring to duck-roll-call-vectors.json, which
 * scripts/make_duck_vectors.py writes from the written rules with no code
 * shared with either implementation. The TypeScript module has the same test.
 *
 * If this fails after a deliberate rule change: change the rule in the module,
 * the doc comment and the script, regenerate the file, and change this twin.
 */
class DuckRollCallScoringTest {

    private static final double EPS = 1e-9;
    private static final ObjectMapper JSON = new ObjectMapper();

    private static JsonNode vectors() throws Exception {
        Path file = Path.of("..", "duck-roll-call-vectors.json");
        assertTrue(Files.exists(file), "duck-roll-call-vectors.json not found at " + file.toAbsolutePath());
        return JSON.readTree(Files.readString(file));
    }

    @Test
    void theFileHasCases() throws Exception {
        assertTrue(vectors().get("vectors").size() >= 12);
    }

    @TestFactory
    Stream<DynamicTest> everyVectorScoresIdentically() throws Exception {
        List<DynamicTest> tests = new ArrayList<>();
        for (JsonNode v : vectors().get("vectors")) {
            tests.add(DynamicTest.dynamicTest(v.get("name").asText(), () -> {
                List<Object> trials = JSON.convertValue(v.get("trials"), new TypeReference<>() { });
                List<ScoreContribution> got = DuckRollCallScoring.score(trials);
                JsonNode want = v.get("expected");
                assertEquals(want.size(), got.size(), "number of contributions");
                for (int i = 0; i < want.size(); i++) {
                    assertEquals(want.get(i).get("target").asText(), got.get(i).target());
                    assertEquals(want.get(i).get("raw").asDouble(), got.get(i).raw(), EPS, "raw of " + got.get(i).target());
                    assertEquals(want.get(i).get("confidence").asDouble(), got.get(i).confidence(), EPS,
                            "confidence of " + got.get(i).target());
                }
            }));
        }
        return tests.stream();
    }
}
