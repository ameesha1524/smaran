package org.smaran.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.HashSet;
import java.util.Set;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * The parts of pairing that are plain functions: the alphabet, how a typed code
 * is read, how it is hashed. What needs a database (single use, expiry, the
 * rate limit, a race between two tablets) is in PairingIT.
 */
class PairingServiceTest {

    @Test
    @DisplayName("the alphabet is the prompt's 27 distinct symbols, with nothing easily mistaken")
    void alphabet() {
        assertEquals("ACDEFGHJKMNPQRTUVWXYZ234679", PairingService.ALPHABET);
        assertEquals(27, PairingService.ALPHABET.length());
        Set<Character> seen = new HashSet<>();
        for (char c : PairingService.ALPHABET.toCharArray()) {
            assertTrue(seen.add(c), "duplicate symbol " + c);
        }
        for (char c : "01OIL5SB8".toCharArray()) {
            assertFalse(PairingService.ALPHABET.indexOf(c) >= 0, "should not contain " + c);
        }
    }

    @Test
    @DisplayName("a typed code is read the same however it is capitalised, spaced or dashed")
    void normalisation() {
        assertEquals("HJ4K2M", PairingService.normalise("HJ4K-2M"));
        assertEquals("HJ4K2M", PairingService.normalise("hj4k2m"));
        assertEquals("HJ4K2M", PairingService.normalise("  hj4k - 2m "));
        assertEquals("HJ4K2M", PairingService.normalise("H J 4 K 2 M"));
    }

    @Test
    @DisplayName("anything that could not have been issued is rejected before it reaches the database")
    void malformed() {
        assertNull(PairingService.normalise(null));
        assertNull(PairingService.normalise(""));
        assertNull(PairingService.normalise("HJ4K2"), "too short");
        assertNull(PairingService.normalise("HJ4K2MX"), "too long");
        assertNull(PairingService.normalise("HJ4K20"), "0 is not in the alphabet");
        assertNull(PairingService.normalise("HJ4K2I"), "I is not in the alphabet");
        assertNull(PairingService.normalise("HJ4K2!"), "punctuation");
    }

    @Test
    @DisplayName("a code is shown as HJ4K-2M")
    void display() {
        assertEquals("HJ4K-2M", PairingService.format("HJ4K2M"));
    }

    @Test
    @DisplayName("the stored hash depends on the pepper, so a database copy alone cannot be checked against guesses")
    void pepper() {
        PairingService a = service("pepper-one");
        PairingService b = service("pepper-two");
        assertEquals(a.hash("HJ4K2M"), a.hash("HJ4K2M"));
        assertNotEquals(a.hash("HJ4K2M"), b.hash("HJ4K2M"));
        assertNotEquals(a.hash("HJ4K2M"), a.hash("HJ4K2N"));
        assertEquals(64, a.hash("HJ4K2M").length());
    }

    @Test
    @DisplayName("generated codes are six symbols from the alphabet, and not all the same")
    void generation() {
        PairingService s = service("p");
        Set<String> seen = new HashSet<>();
        for (int i = 0; i < 200; i++) {
            String code = s.generateCode();
            assertEquals(PairingService.CODE_LENGTH, code.length());
            assertEquals(code, PairingService.normalise(code));
            seen.add(code);
        }
        assertTrue(seen.size() > 190, "200 draws from 387 million should almost never repeat");
    }

    @Test
    @DisplayName("a tablet's fingerprint is kept only if it looks like the random id the tablet made")
    void fingerprint() {
        assertEquals("6f1c2d3e-aaaa-bbbb-cccc-1234567890ab", PairingService.fingerprint("6f1c2d3e-aaaa-bbbb-cccc-1234567890ab"));
        assertNull(PairingService.fingerprint(null));
        assertNull(PairingService.fingerprint(""));
        assertNull(PairingService.fingerprint("has spaces"));
        assertNull(PairingService.fingerprint("x".repeat(65)));
        assertNull(PairingService.fingerprint("<script>"));
    }

    @Test
    @DisplayName("a label is printable and bounded")
    void label() {
        assertEquals("Tablet", PairingService.label(null));
        assertEquals("Tablet", PairingService.label("   "));
        assertEquals("Living room", PairingService.label("  Living\u0000 room \n"));
        assertEquals(120, PairingService.label("x".repeat(500)).length());
    }

    private static PairingService service(String pepper) {
        return new PairingService(null, null, null, null, null, java.time.Clock.systemUTC(), pepper, 72, 180, 5, 15);
    }
}
