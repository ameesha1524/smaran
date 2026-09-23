package org.smaran.service;

import java.time.Duration;
import java.time.Instant;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.List;
import lombok.extern.slf4j.Slf4j;
import org.smaran.domain.AcousticVector;
import org.smaran.repo.AcousticVectorRepository;
import org.smaran.web.Dto;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Voice biomarker trends.
 *
 * Reads five scalars per session and says one careful thing when they move in
 * the same direction for long enough. The wording of that one thing is fixed in
 * code rather than left to a caller, because the difference between a
 * monitoring signal and a diagnosis is the entire clinical and regulatory
 * position of this feature:
 *
 *   "Possible early vocal fatigue pattern — recommend clinical review."
 *
 * Not "early Parkinson's indicator". Not a probability. Not a score.
 */
@Service
@Slf4j
public class AudioBiomarkerService {

    private static final DateTimeFormatter DAY = DateTimeFormatter.ofPattern("yyyy-MM-dd").withZone(ZoneId.systemDefault());

    /** A rise of this proportion between the two halves of the window counts. */
    private static final double RISE_FACTOR = 1.18;

    /** Below this many readings the trend is noise, and we say nothing at all. */
    private static final int MIN_READINGS = 8;

    private final AcousticVectorRepository vectors;

    public AudioBiomarkerService(AcousticVectorRepository vectors) {
        this.vectors = vectors;
    }

    @Transactional
    public AcousticVector store(Dto.AcousticVectorDto dto) {
        // Idempotent on (patientId, capturedAt) so a replayed offline queue does
        // not stack duplicate readings into the trend.
        return vectors.findByPatientIdAndCapturedAt(dto.patientId(), dto.capturedAt())
                .orElseGet(() -> {
                    AcousticVector v = new AcousticVector();
                    v.setPatientId(dto.patientId());
                    v.setSessionId(dto.sessionId());
                    v.setCapturedAt(dto.capturedAt() == null ? Instant.now() : dto.capturedAt());
                    v.setJitter(dto.jitter());
                    v.setShimmer(dto.shimmer());
                    v.setPauseDurationAvg(dto.pauseDurationAvg());
                    v.setSpeechRate(dto.speechRate());
                    v.setPhonationRatio(dto.phonationRatio());
                    return vectors.save(v);
                });
    }

    /** The 30-day rolling trend shown on the caregiver and doctor dashboards. */
    public Dto.TrendResult computeTrend(String patientId) {
        List<AcousticVector> window = vectors.findByPatientIdAndCapturedAtAfterOrderByCapturedAtAsc(
                patientId, Instant.now().minus(Duration.ofDays(30)));

        List<Dto.TrendPoint> points = window.stream()
                .map(v -> new Dto.TrendPoint(DAY.format(v.getCapturedAt()), v.getJitter(), v.getShimmer()))
                .toList();

        if (window.size() < MIN_READINGS) {
            return new Dto.TrendResult(false, null, points);
        }

        int half = window.size() / 2;
        double jitterEarly = mean(window.subList(0, half), true);
        double jitterLate = mean(window.subList(half, window.size()), true);
        double shimmerEarly = mean(window.subList(0, half), false);
        double shimmerLate = mean(window.subList(half, window.size()), false);

        // Both must rise. Jitter alone moves with a head cold.
        boolean rising = jitterLate > jitterEarly * RISE_FACTOR && shimmerLate > shimmerEarly * RISE_FACTOR;

        if (rising) {
            log.info("voice trend flagged for {}", patientId);
        }

        return new Dto.TrendResult(
                rising,
                rising ? "Possible early vocal fatigue pattern — recommend clinical review." : null,
                points);
    }

    private static double mean(List<AcousticVector> xs, boolean jitter) {
        return xs.stream().mapToDouble(v -> jitter ? v.getJitter() : v.getShimmer()).average().orElse(0);
    }
}
