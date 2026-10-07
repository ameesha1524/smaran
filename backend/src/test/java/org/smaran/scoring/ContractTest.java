package org.smaran.scoring;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Comparator;
import java.util.List;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.smaran.scoring.Contract.AlertRule;
import org.smaran.scoring.Contract.DomainId;
import org.smaran.scoring.Contract.SessionEnvelope;
import org.smaran.scoring.Contract.Status;
import org.smaran.scoring.Contract.SubSignalId;

/**
 * The Java half of the contract drift check. golden-vectors.json carries the
 * ids, the constants and a sample session envelope; the TypeScript copy is
 * held to the same file by golden.test.ts. If a field or id is added on one
 * side only, one of the two suites fails.
 */
class ContractTest {

    private final ObjectMapper strict =
            new ObjectMapper().configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, true);

    private static List<String> strings(JsonNode array) {
        List<String> out = new ArrayList<>();
        array.forEach(n -> out.add(n.asText()));
        return out;
    }

    private static List<String> names(Enum<?>[] values) {
        return Arrays.stream(values).map(Enum::name).toList();
    }

    @Test
    @DisplayName("domains, sub-signals, statuses and alert rules match the file, in order")
    void ids() throws Exception {
        JsonNode contract = ScoringEngineGoldenTest.golden().get("contract");
        assertEquals(strings(contract.get("domains")), names(DomainId.values()));
        assertEquals(strings(contract.get("subSignals")), names(SubSignalId.values()));
        assertEquals(strings(contract.get("alertRules")), names(AlertRule.values()));
        assertEquals(strings(contract.get("statuses")), Arrays.stream(Status.values()).map(Status::label).toList());
    }

    @Test
    @DisplayName("the engine version and every constant match the file")
    void constants() throws Exception {
        JsonNode file = ScoringEngineGoldenTest.golden();
        assertEquals(file.get("engineVersion").asText(), Contract.ENGINE_VERSION);
        assertEquals(strict.treeToValue(file.get("config"), ScoringConfig.class), ScoringConfig.DEFAULT);
    }

    @Test
    @DisplayName("the session envelope has exactly the fields the file lists")
    void envelopeFields() throws Exception {
        JsonNode contract = ScoringEngineGoldenTest.golden().get("contract");
        List<String> declared = Arrays.stream(SessionEnvelope.class.getRecordComponents())
                .map(c -> c.getName())
                .toList();
        assertEquals(strings(contract.get("sessionEnvelopeFields")), declared);
    }

    @Test
    @DisplayName("the sample envelope survives a round trip with nothing lost and nothing unknown")
    void sampleEnvelope() throws Exception {
        JsonNode sample = ScoringEngineGoldenTest.golden().get("contract").get("sampleEnvelope");
        // Strict: an unknown field in the file fails here.
        SessionEnvelope envelope = strict.treeToValue(sample, SessionEnvelope.class);
        // And back: a field the record drops or renames fails here.
        // Numbers are compared by value: JSON has one number type, so 4 and 4.0 are the same marker.
        Comparator<JsonNode> byValue = (x, y) ->
                x.isNumber() && y.isNumber() ? Double.compare(x.asDouble(), y.asDouble()) : (x.equals(y) ? 0 : 1);
        JsonNode back = strict.valueToTree(envelope);
        assertTrue(sample.equals(byValue, back), "round trip changed the envelope: " + sample + " became " + back);
    }
}
