package org.smaran.scoring;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.smaran.scoring.SundowningDetector.Sitting;

class SundowningDetectorTest {

    private static List<Sitting> sittings(String game, int hour, double... scores) {
        List<Sitting> out = new ArrayList<>();
        for (double s : scores) {
            out.add(new Sitting(game, hour, s));
        }
        return out;
    }

    private static List<Sitting> concat(List<Sitting>... parts) {
        List<Sitting> all = new ArrayList<>();
        for (List<Sitting> p : parts) {
            all.addAll(p);
        }
        return all;
    }

    @Test
    @DisplayName("a clear late-afternoon dip is flagged")
    @SuppressWarnings("unchecked")
    void flagged() {
        var v = SundowningDetector.evaluate(concat(
                sittings("a", 9, 80, 82, 78, 81, 79, 83, 80),
                sittings("a", 17, 60, 62, 58, 61, 59, 63, 60)));
        assertTrue(v.enoughData());
        assertTrue(v.flagged(), "d = " + v.effectSize());
        assertTrue(v.effectSize() > 3);
        assertEquals(7, v.morning());
        assertEquals(7, v.lateAfternoon());
    }

    @Test
    @DisplayName("no difference, or an afternoon that is better, is not flagged")
    @SuppressWarnings("unchecked")
    void notFlagged() {
        assertFalse(SundowningDetector.evaluate(concat(
                sittings("a", 9, 70, 72, 68, 71, 69, 73),
                sittings("a", 17, 71, 69, 70, 72, 68, 73))).flagged());
        var better = SundowningDetector.evaluate(concat(
                sittings("a", 9, 60, 62, 58, 61, 59, 63),
                sittings("a", 17, 80, 82, 78, 81, 79, 83)));
        assertFalse(better.flagged());
        assertTrue(better.effectSize() < 0);
    }

    @Test
    @DisplayName("too few sittings in either part of the day says nothing, however large the gap")
    @SuppressWarnings("unchecked")
    void guard() {
        var five = SundowningDetector.evaluate(concat(
                sittings("a", 9, 90, 90, 90, 90, 90, 90, 90),
                sittings("a", 17, 10, 10, 10, 10, 10)));
        assertFalse(five.enoughData());
        assertFalse(five.flagged());
        assertTrue(five.clear());
    }

    @Test
    @DisplayName("a game that is only ever played in the afternoon does not look like a dip")
    @SuppressWarnings("unchecked")
    void gamesAreComparedWithThemselves() {
        // Hard game, always in the afternoon, always 50; easy game, always in the morning, always 90.
        var v = SundowningDetector.evaluate(concat(
                sittings("hard", 17, 50, 50, 50, 50, 50, 50),
                sittings("easy", 9, 90, 90, 90, 90, 90, 90)));
        assertTrue(v.enoughData());
        assertEquals(0.0, v.effectSize(), 1e-9);
        assertFalse(v.flagged());
    }

    @Test
    @DisplayName("hours outside both parts of the day are ignored")
    @SuppressWarnings("unchecked")
    void otherHours() {
        var v = SundowningDetector.evaluate(concat(
                sittings("a", 13, 10, 10, 10, 10, 10, 10),
                sittings("a", 22, 10, 10, 10, 10, 10, 10)));
        assertFalse(v.enoughData());
    }

    @Test
    @DisplayName("identical scores cannot turn a tiny gap into a huge effect")
    @SuppressWarnings("unchecked")
    void spreadFloor() {
        var v = SundowningDetector.evaluate(concat(
                sittings("a", 9, 71, 71, 71, 71, 71, 71),
                sittings("a", 17, 70, 70, 70, 70, 70, 70)));
        assertTrue(v.effectSize() < 0.8, "d = " + v.effectSize());
    }

    @Test
    @DisplayName("the detector agrees with sundowning-vectors.json, which the Python evaluation is held to as well")
    void sharedVectors() throws Exception {
        Path file = Path.of("..", "sundowning-vectors.json");
        assertTrue(Files.exists(file), "sundowning-vectors.json not found at " + file.toAbsolutePath());
        JsonNode root = new ObjectMapper().readTree(Files.readString(file));
        assertEquals(SundowningDetector.FLAG_AT, root.get("flagAt").asDouble(), 0.0);
        assertEquals(SundowningDetector.END_BELOW, root.get("endBelow").asDouble(), 0.0);
        assertEquals(SundowningDetector.MIN_PER_PART, root.get("minPerPart").asInt());
        assertTrue(root.get("vectors").size() >= 12);
        for (JsonNode v : root.get("vectors")) {
            List<Sitting> in = new ArrayList<>();
            for (JsonNode s : v.get("sittings")) {
                in.add(new Sitting(s.get("gameId").asText(), s.get("hour").asInt(), s.get("score").asDouble()));
            }
            var got = SundowningDetector.evaluate(in);
            JsonNode want = v.get("expected");
            String name = v.get("name").asText();
            assertEquals(want.get("enoughData").asBoolean(), got.enoughData(), name);
            assertEquals(want.get("morning").asInt(), got.morning(), name);
            assertEquals(want.get("lateAfternoon").asInt(), got.lateAfternoon(), name);
            assertEquals(want.get("effectSize").asDouble(), got.effectSize(), 1e-9, name);
        }
    }
}
