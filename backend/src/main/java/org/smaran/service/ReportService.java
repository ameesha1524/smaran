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
import org.smaran.web.Dto;
import org.springframework.stereotype.Service;

/**
 * The page the caregiver puts in front of a doctor.
 *
 * It is one page on purpose. A neurologist with eleven minutes needs: who this
 * is, what has changed over thirty days, what Smaran noticed, and an explicit
 * statement of what this document is not. Everything else is noise that costs
 * the patient attention she cannot spare.
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

    public byte[] render(Dto.DashboardSummary summary) {
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
                "%s · %s · addressed as %s · generated %s"
                        .formatted(
                                summary.patient().name(),
                                nullSafe(summary.patient().region()),
                                nullSafe(summary.patient().kinshipTerm()),
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
                String.valueOf(summary.sessionsThisWeek()),
                "%d of 4".formatted(summary.garden().bloomStage()),
                String.valueOf(summary.garden().bloomCount()),
                summary.lastActive() == null ? "—" : STAMP.format(summary.lastActive()));
        doc.add(engagement);
        doc.add(spacer());

        /* -------------------------------------------------- domains */

        doc.add(paragraph("Cognitive domains over 30 days", h2, 6));
        if (summary.domainTrend().size() >= 2) {
            Dto.DomainPoint first = summary.domainTrend().get(0);
            Dto.DomainPoint last = summary.domainTrend().get(summary.domainTrend().size() - 1);
            PdfPTable domains = table(new float[] {2, 1, 1, 1});
            header(domains, body, "Domain", "First reading", "Latest", "Change");
            domainRow(domains, body, "Language & cultural identity", first.language(), last.language());
            domainRow(domains, body, "Visual-semantic memory", first.visualSemantic(), last.visualSemantic());
            domainRow(domains, body, "Motor & rhythm", first.motor(), last.motor());
            domainRow(domains, body, "Affective & anxiety", first.affective(), last.affective());
            domainRow(domains, body, "Temporal orientation", first.temporal(), last.temporal());
            doc.add(domains);
        } else {
            doc.add(paragraph("Not enough sessions yet to show a trend.", body, 8));
        }
        doc.add(spacer());

        /* ---------------------------------------------------- games */

        doc.add(paragraph("By game", h2, 6));
        PdfPTable games = table(new float[] {2, 1, 1, 1});
        header(games, body, "Game", "Sessions", "Mean completion", "Direction");
        for (Dto.GamePerformance g : summary.perGame()) {
            row(
                    games,
                    body,
                    readable(g.gameType().name()),
                    String.valueOf(g.sessions()),
                    "%d%%".formatted(Math.round(g.avgScore() * 100)),
                    g.trend().toLowerCase());
        }
        doc.add(games);
        doc.add(spacer());

        /* --------------------------------------- recognition & voice */

        doc.add(paragraph("Family recognition", h2, 6));
        PdfPTable family = table(new float[] {2, 2});
        header(family, body, "Person", "Current phase");
        for (Dto.FamilyPhase f : summary.familyPhases()) {
            row(family, body, f.name(), phaseName(f.phase()));
        }
        doc.add(family);
        doc.add(spacer());

        if (!summary.acousticTrend().isEmpty()) {
            Dto.TrendPoint first = summary.acousticTrend().get(0);
            Dto.TrendPoint last = summary.acousticTrend().get(summary.acousticTrend().size() - 1);
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
        if (summary.alerts().isEmpty()) {
            doc.add(paragraph("Nothing stood out this month.", body, 8));
        } else {
            for (Dto.DashboardAlertDto alert : summary.alerts()) {
                doc.add(paragraph("• " + alert.message(), body, 4));
            }
        }
        doc.add(spacer());

        doc.add(paragraph(
                "Smaran is a cognitive stimulation and engagement tool. The figures above describe how this person "
                        + "interacted with four games over thirty days. They are not a clinical assessment, they are not "
                        + "diagnostic, and no threshold in this document has been validated against a clinical instrument. "
                        + "They are offered as a record of engagement and as a prompt for questions.",
                small,
                0));

        doc.close();
        return out.toByteArray();
    }

    /* ------------------------------------------------------- fragments */

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

    private static void domainRow(PdfPTable table, Font font, String label, double first, double last) {
        long delta = Math.round((last - first) * 100);
        row(
                table,
                font,
                label,
                "%d%%".formatted(Math.round(first * 100)),
                "%d%%".formatted(Math.round(last * 100)),
                (delta > 0 ? "+" : "") + delta + " pts");
    }

    private static String phaseName(int phase) {
        return switch (phase) {
            case 4 -> "4 — recalls unprompted";
            case 3 -> "3 — identifies from choices";
            case 2 -> "2 — recognises from initials";
            default -> "1 — name shown";
        };
    }

    private static String readable(String enumName) {
        String[] parts = enumName.toLowerCase().split("_");
        StringBuilder sb = new StringBuilder();
        for (String part : parts) {
            sb.append(Character.toUpperCase(part.charAt(0))).append(part.substring(1)).append(' ');
        }
        return sb.toString().trim();
    }

    private static String nullSafe(String s) {
        return s == null ? "—" : s;
    }
}
