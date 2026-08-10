'use client';

import ScorekeeperQrCards, { useScorekeeperLinks, useQrPdfExport } from '../../components/ScorekeeperQrCards';
import styles from './page.module.css';

/* The organizer's scorekeeper QR codes for one tournament. On screen: the
 * next match on each court. On paper: every match, grouped by court, via
 * the PDF export. */
export default function ScorekeeperQrPanel({ slug, onClose }: { slug: string; onClose: () => void }) {
  const { matches, loading, error } = useScorekeeperLinks(slug);
  const { exportAll, exporting, error: exportError } = useQrPdfExport(slug);

  return (
    <div className={styles.qrPanel}>
      <div className={styles.qrPanelHeader}>
        <span>Scorekeeper QR codes</span>
        <button className={styles.qrClose} onClick={onClose}>×</button>
      </div>

      {loading && <p className={styles.qrHint}>Loading matches…</p>}
      {error && <p className={styles.qrHint} style={{ color: '#E02424' }}>{error}</p>}
      {!loading && !error && matches.length === 0 && (
        <p className={styles.qrHint}>
          No matches to score yet. Draw the bracket for a division and its matches will appear here.
        </p>
      )}

      {!loading && !error && matches.length > 0 && (
        <>
          <p className={styles.qrHint}>
            The next match on each court. Each code opens that match&apos;s scoring screen — anyone with the
            link can score it, so share only with your referees.
          </p>

          <div className={styles.qrExportBar}>
            <button className={styles.qrExportBtn} onClick={exportAll} disabled={exporting}>
              {exporting ? 'Building PDF…' : 'Export all QR codes (PDF)'}
            </button>
            <span className={styles.qrExportNote}>Every match, one page per court.</span>
          </div>
          {exportError && <p className={styles.qrExportError}>{exportError}</p>}

          <ScorekeeperQrCards matches={matches} />
        </>
      )}
    </div>
  );
}
