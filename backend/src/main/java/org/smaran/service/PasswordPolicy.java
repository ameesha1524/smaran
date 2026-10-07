package org.smaran.service;

import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Set;

/**
 * What a password must be to be accepted.
 *
 * Length is what matters, so the rules are few: at least 10 characters, at most
 * 72 bytes (BCrypt silently ignores anything past that, which would make two
 * different long passwords equal), not a handful of the most common choices,
 * not built from the account's own email, and not one repeated character.
 */
public final class PasswordPolicy {

    public static final int MIN_LENGTH = 10;
    public static final int MAX_BYTES = 72;

    private static final Set<String> COMMON = Set.of(
            "password", "password1", "password12", "password123", "passw0rd123", "1234567890", "12345678910",
            "qwertyuiop", "qwerty12345", "iloveyou123", "welcome123", "welcome1234", "letmein1234", "admin12345",
            "smaran1234", "changeme123", "abcdefghij", "0123456789", "1q2w3e4r5t", "monkey12345", "dragon12345");

    private PasswordPolicy() {
    }

    /** What is wrong with this password, in words a person can act on; empty when it is acceptable. */
    public static List<String> problems(String password, String email) {
        if (password == null || password.isBlank()) {
            return List.of("Enter a password.");
        }
        List<String> out = new java.util.ArrayList<>();
        if (password.codePointCount(0, password.length()) < MIN_LENGTH) {
            out.add("Use at least " + MIN_LENGTH + " characters.");
        }
        if (password.getBytes(StandardCharsets.UTF_8).length > MAX_BYTES) {
            out.add("Use at most " + MAX_BYTES + " bytes; shorten it.");
        }
        String lower = password.toLowerCase();
        if (COMMON.contains(lower)) {
            out.add("That password is too common.");
        }
        if (password.chars().distinct().count() <= 2) {
            out.add("Use more than one or two different characters.");
        }
        if (email != null && !email.isBlank()) {
            String local = email.trim().toLowerCase().split("@", 2)[0];
            if (local.length() >= 4 && lower.contains(local)) {
                out.add("Do not build the password from your email.");
            }
        }
        return out;
    }

    public static boolean isAcceptable(String password, String email) {
        return problems(password, email).isEmpty();
    }
}
