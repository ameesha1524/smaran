package org.smaran.service;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.stream.Collectors;
import java.util.stream.IntStream;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

class PasswordPolicyTest {

    @Test
    @DisplayName("a long, ordinary passphrase is accepted")
    void accepts() {
        assertTrue(PasswordPolicy.isAcceptable("correct-horse-battery", "a@example.com"));
        assertTrue(PasswordPolicy.isAcceptable(bengali(12), "a@example.com"));
    }

    @Test
    @DisplayName("short, empty and blank passwords are refused with something a person can act on")
    void tooShort() {
        for (String bad : new String[] {null, "", "   ", "short", "123456789"}) {
            assertFalse(PasswordPolicy.isAcceptable(bad, "a@example.com"), String.valueOf(bad));
            assertFalse(PasswordPolicy.problems(bad, "a@example.com").isEmpty());
        }
    }

    @Test
    @DisplayName("common passwords, repeated characters and the email itself are refused")
    void weak() {
        assertFalse(PasswordPolicy.isAcceptable("Password123", "a@example.com"));
        assertFalse(PasswordPolicy.isAcceptable("aaaaaaaaaaaa", "a@example.com"));
        assertFalse(PasswordPolicy.isAcceptable("ababababab", "a@example.com"));
        assertFalse(PasswordPolicy.isAcceptable("rupa.baruah-2026", "rupa.baruah@example.com"));
        assertTrue(PasswordPolicy.isAcceptable("rupa-and-the-river", "r@example.com"), "a short local part is not a rule");
    }

    @Test
    @DisplayName("more than 72 bytes is refused, because BCrypt would silently ignore the rest")
    void tooLong() {
        assertTrue(PasswordPolicy.isAcceptable("ab1c".repeat(18), "a@example.com"));
        assertFalse(PasswordPolicy.isAcceptable("ab1c".repeat(19), "a@example.com"));
        // Bengali letters are three bytes each in UTF-8: 24 of them is exactly 72 bytes, 25 is 75.
        assertTrue(PasswordPolicy.isAcceptable(bengali(24), "a@example.com"));
        assertFalse(PasswordPolicy.isAcceptable(bengali(25), "a@example.com"));
    }

    private static String bengali(int letters) {
        return IntStream.range(0x0995, 0x0995 + letters).mapToObj(Character::toString).collect(Collectors.joining());
    }
}
