package org.smaran.web;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import org.smaran.domain.DomainReading;
import org.smaran.domain.Enums.AlertLevel;
import org.smaran.domain.Enums.GameType;
import org.smaran.domain.Enums.Mood;
import org.smaran.domain.Enums.MotorTier;
import org.smaran.domain.Enums.PeakWindow;
import org.smaran.domain.Enums.SemanticCluster;

/**
 * Every payload that crosses the wire, in one place.
 *
 * These are records rather than entities on purpose: the JSON shape the device
 * expects is a stable contract, and it must not change because someone renamed
 * a column. Field names here match frontend/src/lib/types.ts exactly.
 */
public final class Dto {

    private Dto() {
    }

    /* ------------------------------------------------------------- auth */

    public record LoginRequest(String email, String password) {
    }

    /**
     * What a sign-in returns in the body. The refresh token is not here: it
     * travels only in an HttpOnly cookie that scripts cannot read.
     */
    public record LoginResponse(
            String accessToken,
            String role,
            String userId,
            String name,
            String status,
            List<String> patientIds) {
    }

    public record RegisterRequest(String name, String email, String password, String role, String phone) {
    }

    /** Doctors register as PENDING and get no tokens until an admin approves them. */
    public record RegisterResponse(String userId, String status, String message, LoginResponse session) {
    }

    public record MeResponse(String userId, String name, String email, String role, String status, List<String> patientIds) {
    }

    public record CreatePatientRequest(
            String name,
            String languageCode,
            String kinshipTerm,
            String region,
            String faith,
            PeakWindow peakWindow,
            boolean guardianConsent,
            String guardianName,
            String noticeVersion) {
    }

    public record GrantRequest(String doctorEmail, Integer days) {
    }

    public record GrantDto(
            String id, String patientId, String doctorUserId, String doctorName, String doctorEmail,
            Instant grantedAt, Instant expiresAt, Instant revokedAt, boolean live) {
    }

    /** What a doctor sees of a patient they have been given: enough to open her dashboard, nothing more. */
    public record DoctorPatientDto(String patientId, String name, Instant sharedUntil) {
    }

    public record AdminUserDto(
            String id, String name, String email, String role, String status, Instant createdAt, Instant lastLoginAt) {
    }

    /* ---------------------------------------------------------- patient */

    public record PatientDto(
            String id,
            String name,
            String languageCode,
            String kinshipTerm,
            String region,
            String faith,
            PeakWindow peakWindow,
            String profileVersion,
            String caregiverId,
            CognitiveProfileDto cognitiveProfile) {
    }

    public record PatientPatch(
            String name,
            String languageCode,
            String kinshipTerm,
            String region,
            String faith,
            PeakWindow peakWindow,
            String profileVersion) {
    }

    public record CognitiveProfileDto(
            String patientId,
            Map<String, Double> domainScores,
            Map<String, org.smaran.scoring.Contract.TargetState> scoring,
            MotorTier motorTier,
            double anxietyThreshold,
            int startingPhase,
            boolean sundowningPattern,
            Map<String, Double> clusterAccuracy,
            PeakWindow selfReportedPeak,
            PeakWindow derivedPeak,
            Instant updatedAt) {
    }

    /* --------------------------------------------------------- sessions */

    public record ObjectResultDto(
            String objectName,
            SemanticCluster semanticCluster,
            long tappedMs,
            boolean wasCorrect) {
    }

    public record SessionSubmission(
            String patientId,
            GameType gameType,
            Instant startedAt,
            long durationMs,
            double completionRate,
            int difficultyTier,
            double cognitiveLoadScore,
            Mood moodAtStart,
            List<ObjectResultDto> objectResults,
            /** Optional. Absent → completion rate against the game's primary domain. */
            Map<String, DomainReading> domainReadings,
            /** Optional, opaque, caregiver-view only. */
            Map<String, Object> metrics) {
    }

    /* ----------------------------------------------------------- garden */

    public record GardenDto(
            String patientId,
            int bloomStage,
            int growthPoints,
            boolean restingPhase,
            Instant lastActivity,
            int bloomCount) {
    }

    public record WaterRequest(GameType gameType, Instant at, Double completionRate) {
    }

    /* ----------------------------------------------------------- family */

    public record FamilyMemberDto(
            String id,
            String patientId,
            String name,
            String relationship,
            String kinshipTermLocal,
            String photoUrl,
            String voiceNoteUrl,
            String contextHint,
            int currentPhase) {
    }

    public record RecognitionResult(boolean correct, long latencyMs) {
    }

    /* ------------------------------------------------------------ route */

    public record GameRouteDto(
            String patientId,
            List<GameType> games,
            int difficultyTier,
            int ambientHz,
            int tapTargetPx,
            boolean withinPeakWindow,
            List<String> rationale) {
    }

    /* -------------------------------------------------------- cognitive */

    public record LoadSample(
            String sessionId,
            double score,
            Double browFurrow,
            Double eyeOpenness,
            Double fixationMs,
            Double latencyMs) {
    }

    public record DifficultyEaseEvent(String sessionId, double loadScore, int ambientHz, String reason) {
    }

    /* -------------------------------------------------------- biomarker */

    public record AcousticVectorDto(
            String patientId,
            String sessionId,
            Instant capturedAt,
            double jitter,
            double shimmer,
            double pauseDurationAvg,
            double speechRate,
            double phonationRatio) {
    }

    public record TrendResult(boolean rising, String message, List<TrendPoint> points) {
    }

    public record TrendPoint(String date, double jitter, double shimmer) {
    }

    /* ------------------------------------------------------------- sync */

    public record SyncRequest(
            String patientId,
            List<SessionSubmission> sessions,
            List<AcousticVectorDto> vectors,
            List<WaterRequest> blooms) {
    }

    public record SyncResponse(int accepted, int duplicates, GardenDto garden) {
    }

    /* --------------------------------------------------------------- FL */

    public record GradientUpload(String deviceId, String patientId, String modelVersion, String cipher) {
    }

    public record GlobalModel(String modelVersion, List<Double> weights) {
    }

    /* -------------------------------------------------------- dashboard */

    public record DashboardAlertDto(AlertLevel level, String code, String message) {
    }

    public record MoodPoint(String date, Mood mood) {
    }

    public record DomainPoint(
            String date,
            double language,
            double visualSemantic,
            double motor,
            double affective,
            double temporal,
            double executiveFunction) {
    }

    public record HeatPoint(String date, long minutes) {
    }

    public record GamePerformance(GameType gameType, long sessions, double avgScore, String trend) {
    }

    public record FamilyPhase(String id, String name, int phase) {
    }

    public record DashboardSummary(
            PatientDto patient,
            GardenDto garden,
            long sessionsThisWeek,
            Instant lastActive,
            List<MoodPoint> moodTrend,
            List<DomainPoint> domainTrend,
            List<HeatPoint> heatmap,
            List<GamePerformance> perGame,
            List<FamilyPhase> familyPhases,
            List<DashboardAlertDto> alerts,
            List<TrendPoint> acousticTrend) {
    }

    /* -------------------------------------------------------- reminders */

    public record ReminderDto(
            String id,
            String patientId,
            String type,
            String scheduledTime,
            String photoUrl,
            String messageTemplate,
            String languageCode) {
    }

    public record TriggerRequest(String patientId) {
    }

    /* ---------------------------------------------------------- pairing */

    /** The code is returned once, formatted {@code XXXX-XXXX}; only its hash is stored. */
    public record PairingCodeDto(String code, Instant expiresAt) {
    }

    public record RedeemRequest(String code, String deviceLabel) {
    }

    public record RedeemResponse(
            String deviceToken,
            String deviceId,
            String patientId,
            Instant expiresAt,
            PatientDto patient) {
    }

    public record DeviceDto(String id, String label, Instant pairedAt, Instant lastSeenAt, Instant expiresAt) {
    }

    /* -------------------------------------------------- mood check-in */

    public record MoodCheckIn(String patientId, Mood mood, Integer localHour) {
    }
}
