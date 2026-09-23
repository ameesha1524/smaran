package org.smaran.domain;

/**
 * The closed vocabularies of the domain, kept together so that the device and
 * the server cannot drift apart on spelling.
 *
 * Every one of these is mirrored in frontend/src/lib/types.ts.
 */
public final class Enums {

    private Enums() {
    }

    public enum GameType {
        WEAVERS_LOOM,
        GRANDMOTHERS_TALE,
        FAMILY_GROVE,
        MORNING_RITUALS
    }

    /** Fluid ±150 ms · Moderate ±400 ms · Supported (erratic or abandoned). */
    public enum MotorTier {
        FLUID,
        MODERATE,
        SUPPORTED
    }

    public enum SemanticCluster {
        MUSICAL,
        NATURE,
        DAILY_LIFE,
        CRAFT,
        FOOD
    }

    /** Warm words only. Nothing clinical ever reaches the patient's screen. */
    public enum Mood {
        JOYFUL,
        PEACEFUL,
        QUIET,
        SLEEPY,
        A_LITTLE_LOW,
        WORRIED,
        RESTLESS,
        THINKING;

        /** The three that route a session to Family Grove at 432 Hz. */
        public boolean isLow() {
            return this == A_LITTLE_LOW || this == WORRIED || this == RESTLESS;
        }
    }

    public enum PeakWindow {
        EARLY_MORNING(5, 8),
        MORNING(8, 11),
        MIDDAY(11, 14),
        AFTERNOON(14, 17),
        EVENING(17, 20),
        NIGHT(20, 23);

        private final int from;
        private final int to;

        PeakWindow(int from, int to) {
            this.from = from;
            this.to = to;
        }

        /** An hour of grace either side: this is her rhythm, not a gate. */
        public boolean contains(int hour) {
            return hour >= from - 1 && hour < to + 1;
        }

        public static PeakWindow forHour(int hour) {
            for (PeakWindow w : values()) {
                if (hour >= w.from && hour < w.to) {
                    return w;
                }
            }
            return NIGHT;
        }
    }

    public enum ReminderType {
        MEDICINE,
        HYDRATION,
        APPOINTMENT
    }

    public enum Role {
        PATIENT,
        CAREGIVER,
        DOCTOR,
        ADMIN
    }

    public enum AlertLevel {
        ORANGE,
        AMBER,
        YELLOW
    }
}
