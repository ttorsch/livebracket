import { jsPDF } from 'jspdf';
import QRCode from 'qrcode';
import { groupByCourt, timeLabel, type ScorekeeperLinkRow } from './scorekeeperLinks';

/* ── Printable sheet of scorekeeper QR codes ──────────────────────
 *
 * The dashboard panel only ever shows the *next* match per court, because
 * that is the one a referee needs a link to right now. This module covers
 * the other job: a paper handout of every match, laid out court by court,
 * that an organizer prints once in the morning and cuts up.
 *
 * Built in the browser rather than a route because the panel already has
 * the match list and the origin, and because generating a token-bearing
 * PDF server-side would mean a second endpoint handing out credentials.
 * The caller imports this lazily so jsPDF stays out of the dashboard's
 * initial bundle.
 */

/* A4 portrait in mm, with a 3x3 grid of cards. Three columns keeps each QR
 * at 46mm — comfortably scannable by a phone held at arm's length, which is
 * how these get used once they're taped to a post. */
const PAGE_W = 210;
const PAGE_H = 297;
const MARGIN = 12;
const HEADER_H = 24;
const FOOTER_H = 12;
const COLS = 3;
const ROWS = 3;
const GUTTER = 5;
const PER_PAGE = COLS * ROWS;

const CARD_W = (PAGE_W - MARGIN * 2 - GUTTER * (COLS - 1)) / COLS;
const GRID_TOP = MARGIN + HEADER_H;
const ROW_PITCH = (PAGE_H - FOOTER_H - GRID_TOP) / ROWS;
const CARD_H = ROW_PITCH - GUTTER;
const QR_SIZE = 46;

// Pulled from the app's palette so a printout reads as the same product.
const INK: [number, number, number] = [20, 24, 30];
const MUTED: [number, number, number] = [122, 130, 148];
const CORAL: [number, number, number] = [235, 111, 67];
const BORDER: [number, number, number] = [231, 226, 217];
const LIVE: [number, number, number] = [241, 103, 103];

/* Draw a QR as filled rectangles instead of a rasterised image.
 *
 * A PNG scaled into a PDF softens at print resolution and costs ~4KB per
 * code; vector modules stay sharp at any size and compress to almost
 * nothing. Horizontally adjacent dark modules are merged into one run,
 * which roughly halves the operator count. */
function drawQr(doc: jsPDF, text: string, x: number, y: number, size: number) {
  const { modules } = QRCode.create(text, { errorCorrectionLevel: 'M' });
  const n = modules.size;
  const quiet = 2; // modules of quiet zone; below 2 some scanners struggle
  const unit = size / (n + quiet * 2);

  // White field under the code so the quiet zone survives the card's fill.
  doc.setFillColor(255, 255, 255);
  doc.rect(x, y, size, size, 'F');

  doc.setFillColor(...INK);
  for (let row = 0; row < n; row++) {
    let runStart = -1;
    // One past the end so a run touching the right edge still gets flushed.
    for (let col = 0; col <= n; col++) {
      const dark = col < n && modules.data[row * n + col] === 1;
      if (dark && runStart < 0) runStart = col;
      if (!dark && runStart >= 0) {
        doc.rect(
          x + (quiet + runStart) * unit,
          y + (quiet + row) * unit,
          (col - runStart) * unit,
          // A hair of overlap: without it some viewers render a white
          // hairline between vertically adjacent runs. At 2% of a ~1.3mm
          // module this is well under a printer dot.
          unit * 1.02,
          'F',
        );
        runStart = -1;
      }
    }
  }
}

/** Fit text to one line, ellipsising rather than wrapping or overflowing. */
function clampLine(doc: jsPDF, text: string, width: number): string {
  if (!text) return '';
  if (doc.getTextWidth(text) <= width) return text;
  let cut = text;
  while (cut.length > 1 && doc.getTextWidth(`${cut}…`) > width) cut = cut.slice(0, -1);
  return `${cut}…`;
}

function drawPageHeader(doc: jsPDF, title: string, court: string, continued: boolean, generated: string) {
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.setTextColor(...INK);
  doc.text(clampLine(doc, title, PAGE_W - MARGIN * 2 - 45), MARGIN, MARGIN + 4);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(...MUTED);
  doc.text(generated, PAGE_W - MARGIN, MARGIN + 4, { align: 'right' });

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(...CORAL);
  doc.text(`${court.toUpperCase()}${continued ? ' (CONT.)' : ''}`, MARGIN, MARGIN + 12);

  doc.setDrawColor(...BORDER);
  doc.setLineWidth(0.3);
  doc.line(MARGIN, MARGIN + 15, PAGE_W - MARGIN, MARGIN + 15);
}

function drawCard(doc: jsPDF, m: ScorekeeperLinkRow, origin: string, x: number, y: number) {
  doc.setDrawColor(...BORDER);
  doc.setLineWidth(0.3);
  doc.roundedRect(x, y, CARD_W, CARD_H, 3, 3, 'S');

  drawQr(doc, `${origin}/score/${m.token}`, x + (CARD_W - QR_SIZE) / 2, y + 5, QR_SIZE);

  const textX = x + 4;
  const textW = CARD_W - 8;
  let cursor = y + 5 + QR_SIZE + 6;

  // Teams get two lines because doubles pairings are long and the names are
  // the only way a referee tells two codes on the same court apart.
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(...INK);
  const teamLines = (doc.splitTextToSize(`${m.teamA} vs ${m.teamB}`, textW) as string[]).slice(0, 2);
  for (const line of teamLines) {
    doc.text(line, textX, cursor);
    cursor += 4.2;
  }
  cursor += 0.6;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  doc.setTextColor(...MUTED);
  doc.text(clampLine(doc, `${m.division} · ${m.round}`, textW), textX, cursor);
  cursor += 3.6;

  if (m.status === 'live') {
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...LIVE);
    doc.text(clampLine(doc, `LIVE · ${timeLabel(m.time)}`, textW), textX, cursor);
    doc.setFont('helvetica', 'normal');
  } else {
    doc.setTextColor(...MUTED);
    doc.text(clampLine(doc, m.status === 'done' ? `Final · ${timeLabel(m.time)}` : timeLabel(m.time), textW), textX, cursor);
  }
  cursor += 3.6;

  doc.setFontSize(6.5);
  doc.setTextColor(...MUTED);
  doc.text(clampLine(doc, `/score/${m.token.slice(0, 12)}…`, textW), textX, cursor);
}

export interface BuildPdfArgs {
  /** Tournament title, printed at the top of every page. */
  title: string;
  /** Used for the filename only. */
  slug: string;
  /** Scheme + host the /score links resolve against, e.g. window.location.origin. */
  origin: string;
  matches: ScorekeeperLinkRow[];
}

/* Lay out the sheet and return the document. Split from the download step
 * so the layout can be rendered and inspected outside a browser. Throws if
 * there is nothing to print, so the caller can say so rather than handing
 * over a blank PDF. */
export function renderScorekeeperPdf({ title, origin, matches }: Omit<BuildPdfArgs, 'slug'>): jsPDF {
  if (matches.length === 0) throw new Error('There are no matches to export yet.');

  const doc = new jsPDF({ unit: 'mm', format: 'a4', compress: true });
  const generated = `Generated ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
  const groups = groupByCourt(matches);

  groups.forEach(([court, list], groupIndex) => {
    list.forEach((m, i) => {
      const slot = i % PER_PAGE;
      // Every court opens a page; a court with more than nine matches
      // continues onto the next one.
      if (slot === 0) {
        if (groupIndex > 0 || i > 0) doc.addPage();
        drawPageHeader(doc, title, court, i > 0, generated);
      }
      const col = slot % COLS;
      const row = Math.floor(slot / COLS);
      drawCard(
        doc,
        m,
        origin,
        MARGIN + col * (CARD_W + GUTTER),
        GRID_TOP + row * ROW_PITCH,
      );
    });
  });

  // Page numbers need the final count, so they go on in a second pass.
  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(...MUTED);
    doc.text('Anyone with a code can score that match — hand out only to referees.', MARGIN, PAGE_H - 6);
    doc.text(`Page ${p} of ${pages}`, PAGE_W - MARGIN, PAGE_H - 6, { align: 'right' });
  }

  return doc;
}

/** Build the sheet and hand it to the browser as a download. */
export function buildScorekeeperPdf({ slug, ...rest }: BuildPdfArgs): void {
  renderScorekeeperPdf(rest).save(`${slug}-scorekeeper-qr.pdf`);
}
