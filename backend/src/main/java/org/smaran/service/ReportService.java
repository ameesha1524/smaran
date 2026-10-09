package org.smaran.service;

import com.lowagie.text.Document;
import com.lowagie.text.Element;
import com.lowagie.text.Font;
import com.lowagie.text.FontFactory;
import com.lowagie.text.PageSize;
import com.lowagie.text.Paragraph;
import com.lowagie.text.pdf.PdfPCell;
import com.lowagie.text.pdf.PdfPTable;
import com.lowagie.text.pdf.PdfWriter;
import java.awt.Color;
import java.io.ByteArrayOutputStream;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.List;
import org.smaran.web.Dto;
import org.springframework.stereotype.Service;

/**
 * The page the caregiver puts in front of a doctor.
 *
 * It is one page on purpose. A neurologist with eleven minutes needs: who this
 * is, how she has been playing, what the profile says about each domain and how
 * sure it is, what Smaran noticed, and an explicit statement of what this
 * document is not. Everything else costs the patient attention she cannot spare.
 *
 * Fed from the same view the dashboards read, so the page and the screen cannot
 * disagree. It names no family member: the people who visit her are not the
 * doctor's business.
 *
 * JasperReports is the eventual target (see resources/reports/cognitive-trend.jrxml
 * for the placeholder template). OpenPDF renders the same content today without
 * putting a reporting engine in the container image.
 */
@Service
public class ReportService {

    private static final DateTimeFormatter STAMP =
            DateTimeFormatter.ofPattern("d MMMM yyyy, HH:mm").withZone(ZoneId.systemDefault());

    private static final Color INK = new Color(0x08, 0x0f, 0x1e);
    private static final Color MUTED = new Color(0x55, 0x5a, 0x66);
    private static final Color RULE = new Color(0xDD, 0xDD, 0xD5);

    public byte[] render(Dto.DashboardView view) {
        Document doc = new Document(PageSize.A4, 54, 54, 54, 54);
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        PdfWriter.getInstance(doc, out);
        doc.open();

        Font h1 = FontFactory.getFont(FontFactory.TIMES_BOLD, 20, INK);
        Font h2 = FontFactory.getFont(FontFactory.HELVETICA_BOLD, 11, INK);
        Font body = FontFactory.getFont(FontFactory.HELVETICA, 10, INK);
        Font small = FontFactory.getFont(FontFactory.HELVETICA_OBLIQUE, 8.5f, MUTED);

        doc.add(paragraph("Smaran — cognitive engagement summary", h1, 4));
        doc.add(paragraph(
                "%s · addressed as %s · generated %s"
                        .formatted(
                                view.patient().name(),
                                nullSafe(view.patient().kinshipTerm()),
                                STAMP.format(java.time.Instant.now())),
                small,
                16));

        /* ------------------------------------------------ engagement */

        doc.add(paragraph("Engagement", h2, 6));
        PdfPTable engagement = table(new float[] {1, 1, 1, 1});
        header(engagement, body, "Sessions (7 days)", "Garden stage", "Total blooms", "Last active");
        row(
                engagement,
                body,
                String.valueOf(view.sessionsLast7Days()),
                "%d of 4".formatted(view.garden().bloomStage()),
                String.valueOf(view.garden().bloomCount()),
                view.lastActive() == null ? "—" : STAMP.format(view.lastActive()));
        doc.add(engagement);
        doc.add(spacer());

        /* -------------------------------------------------- domains */

        doc.add(paragraph("Where she is, against her own usual", h2, 6));
        PdfPTable domains = table(new float[] {3, 1, 1.2f, 1.2f, 1.6f});
        header(domains, body, "Domain", "Level (0–100)", "Reading", "Confidence", "Recent");
        for (Dto.DomainCard c : view.domains()) {
            row(domains, body, c.label(), level(c), c.observations() == 0 ? "—" : c.status(),
                    c.observations() == 0 ? "—" : "%d%%".formatted(Math.round(c.confidence() * 100)), trend(c.spark()));
        }
        for (Dto.DomainCard c : view.subSignals()) {
            row(domains, body, c.label() + " (marker)", level(c), c.status(),
                    "%d%%".formatted(Math.round(c.confidence() * 100)), trend(c.spark()));
        }
        doc.add(domains);
        doc.add(paragraph(
                "Each reading compares her latest session with her own recent average, in units of how much she "
                        + "normally varies. Until a domain has about a dozen readings it is shown as stable whatever "
                        + "it says, because a few sessions cannot tell a change from a bad day.",
                small, 4));
        if (view.markers() != null) {
            StringBuilder m = new StringBuilder("Clinician markers: ");
            if (view.markers().workingMemorySpan() != null) {
                m.append("working-memory span %.0f. ".formatted(view.markers().workingMemorySpan()));
            }
            if (view.markers().inhibitionBreakdownTier() != null) {
                m.append("inhibition breakdown tier %.0f. ".formatted(view.markers().inhibitionBreakdownTier()));
            }
            if (view.markers().trajectoryPrecisionMs() != null) {
                m.append("trajectory precision %.0f ms. ".formatted(view.markers().trajectoryPrecisionMs()));
            }
            doc.add(paragraph(m.toString().strip(), body, 4));
        }
        doc.add(spacer());

        /* --------------------------------------------------- voice */

        List<Dto.TrendPoint> acoustic = view.acousticTrend();
        if (acoustic != null && !acoustic.isEmpty()) {
            Dto.TrendPoint first = acoustic.get(0);
            Dto.TrendPoint last = acoustic.get(acoustic.size() - 1);
            doc.add(paragraph("Voice acoustics (feature vectors only — no audio is recorded)", h2, 6));
            PdfPTable voice = table(new float[] {2, 1, 1});
            header(voice, body, "Feature", "First", "Latest");
            row(voice, body, "Jitter", "%.4f".formatted(first.jitter()), "%.4f".formatted(last.jitter()));
            row(voice, body, "Shimmer", "%.4f".formatted(first.shimmer()), "%.4f".formatted(last.shimmer()));
            doc.add(voice);
            doc.add(spacer());
        }

        /* --------------------------------------------------- notes */

        doc.add(paragraph("What Smaran noticed", h2, 6));
        if (view.alerts().isEmpty()) {
            doc.add(paragraph("Nothing stood out.", body, 8));
        } else {
            for (Dto.AlertView alert : view.alerts()) {
                doc.add(paragraph("• " + alert.message(), body, 4));
            }
        }
        doc.add(spacer());

        doc.add(paragraph(
                "Smaran is a cognitive stimulation and engagement tool. The figures above describe how this person "
                        + "interacted with its games. They are not a clinical assessment, they are not diagnostic, and no "
                        + "threshold in this document has been validated against a clinical instrument. They are offered "
                        + "as a record of engagement and as a prompt for questions.",
                small,
                0));

        doc.close();
        return out.toByteArray();
    }

    /* ------------------------------------------------------- fragments */

    private static String level(Dto.DomainCard c) {
        return c.observations() == 0 ? "—" : "%.0f".formatted(c.level());
    }

    /** "52 → 47" over the recent snapshots, or a dash when there is nothing to compare. */
    private static String trend(List<Double> spark) {
        if (spark == null || spark.size() < 2) {
            return "—";
        }
        return "%.0f → %.0f".formatted(spark.get(0), spark.get(spark.size() - 1));
    }

    private static Paragraph paragraph(String text, Font font, float spacingAfter) {
        Paragraph p = new Paragraph(text, font);
        p.setSpacingAfter(spacingAfter);
        return p;
    }

    private static Paragraph spacer() {
        Paragraph p = new Paragraph(" ");
        p.setSpacingAfter(10);
        return p;
    }

    private static PdfPTable table(float[] widths) {
        PdfPTable table = new PdfPTable(widths);
        table.setWidthPercentage(100);
        table.setSpacingBefore(4);
        return table;
    }

    private static void header(PdfPTable table, Font font, String... labels) {
        Font bold = FontFactory.getFont(FontFactory.HELVETICA_BOLD, font.getSize(), MUTED);
        for (String label : labels) {
            PdfPCell cell = new PdfPCell(new Paragraph(label, bold));
            cell.setBorder(Element.ALIGN_BOTTOM);
            cell.setBorderColor(RULE);
            cell.setPadding(5);
            table.addCell(cell);
        }
    }

    private static void row(PdfPTable table, Font font, String... values) {
        for (String value : values) {
            PdfPCell cell = new PdfPCell(new Paragraph(value, font));
            cell.setBorder(Element.ALIGN_BOTTOM);
            cell.setBorderColor(RULE);
            cell.setPadding(5);
            table.addCell(cell);
        }
    }

    private static String nullSafe(String s) {
        return s == null ? "—" : s;
    }
}
