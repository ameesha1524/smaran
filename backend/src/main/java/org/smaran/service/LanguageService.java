package org.smaran.service;

import java.util.List;
import java.util.Map;
import org.springframework.stereotype.Service;

/**
 * Locale plus cultural register → the words she actually hears.
 *
 * This service exists because translation alone is not enough. "Welcome" in
 * Assamese, spoken to a stranger, is not what her granddaughter says when she
 * walks into the room. What the server stores per language is a greeting shape
 * with a slot for the kinship term her family uses, and the kinship term itself
 * comes from setup — never from the language code.
 *
 * The strings below mirror frontend/src/i18n/strings.ts. The Assamese, Manipuri,
 * Mizo and Nagamese lines are a best attempt from the brief and are marked
 * unreviewed; they must be replaced with a native speaker's phrasing before a
 * pilot, and the caregiver UI warns about exactly that.
 */
@Service
public class LanguageService {

    public record Greeting(String greeting, String goldLine, String sub, boolean reviewed) {
    }

    private static final Map<String, Greeting> GREETINGS = Map.of(
            "en", new Greeting("Welcome home, {kin}", "it is quiet here",
                    "The pond is warm tonight. Stay as long as you like.", true),
            "as", new Greeting("{kin}, আহক", "এই নীৰৱতাত",
                    "পুখুৰীটো আজি শান্ত। ইচ্ছা হ’লে বহি থাকক।", false),
            "mni", new Greeting("{kin}, লাকপা", "তোপা শান্তিদা",
                    "পুখ্রী অসি ঙসি ইং-না লৈরি।", false),
            "lus", new Greeting("{kin}, lût rawh", "hmun thianghlim ah",
                    "Dâwn hi a muang e. I duh chhûng zawng i awm thei.", false),
            "hi", new Greeting("{kin}, आइए", "इस शांति में",
                    "तालाब आज शांत है। जितना चाहें, बैठिए।", false),
            "nag", new Greeting("{kin}, ahibi", "yate shanti ase",
                    "Pukhuri aji thanda ase. Kiman mon lage bohibi.", false));

    private static final Map<String, List<String>> KINSHIP_SUGGESTIONS = Map.of(
            "as", List.of("আইতা", "ককাদেউতা", "Aaita", "Deuta"),
            "mni", List.of("ইমা", "ইপা", "Ima", "Ipa"),
            "lus", List.of("Pi", "Pu", "Nu", "Pa"),
            "hi", List.of("दादी", "दादा", "नानी", "नाना"),
            "nag", List.of("Aaita", "Koka", "Ama", "Baba"),
            "en", List.of("Grandmother", "Grandfather", "Mother", "Father"));

    /** The instrument that sits under the soundscape, chosen by region. */
    private static final Map<String, String> REGION_INSTRUMENT = Map.of(
            "assam", "pepa",
            "mizoram", "chapel-bell",
            "nagaland", "chapel-bell",
            "manipur", "pepa",
            "arunachal", "monastery-chime",
            "sikkim", "monastery-chime");

    /**
     * Build the line she sees on opening the app. `bloomCount` is deliberately
     * unused in the words themselves — the garden says how it is going, and the
     * greeting stays a greeting rather than becoming a progress report.
     */
    public String buildGreeting(String languageCode, String kinshipTerm, int bloomCount) {
        Greeting g = greetingFor(languageCode);
        String kin = kinshipTerm == null || kinshipTerm.isBlank()
                ? suggestKinship(languageCode).stream().findFirst().orElse("")
                : kinshipTerm;
        return g.greeting().replace("{kin}", kin).replaceFirst("^,\\s*", "") + ", " + g.goldLine();
    }

    public Greeting greetingFor(String languageCode) {
        return GREETINGS.getOrDefault(languageCode, GREETINGS.get("en"));
    }

    public List<String> suggestKinship(String languageCode) {
        return KINSHIP_SUGGESTIONS.getOrDefault(languageCode, KINSHIP_SUGGESTIONS.get("en"));
    }

    public String instrumentFor(String region) {
        if (region == null) {
            return "none";
        }
        String key = region.toLowerCase();
        return REGION_INSTRUMENT.entrySet().stream()
                .filter(e -> key.contains(e.getKey()))
                .map(Map.Entry::getValue)
                .findFirst()
                .orElse("none");
    }

    /** Render a reminder in her language, with her name in it. */
    public String renderReminder(String template, String kinshipTerm) {
        return template.replace("{kin}", kinshipTerm == null ? "" : kinshipTerm).trim();
    }

    /**
     * True when this language's phrasing has been checked by a native speaker.
     * The caregiver UI surfaces this; nothing ships to a patient on a false.
     */
    public boolean isReviewed(String languageCode) {
        return greetingFor(languageCode).reviewed();
    }
}
