'use client';

import { useEffect } from 'react';
import { QrCode, X, Bell } from 'lucide-react';
import ScorekeeperQrCards, { useScorekeeperLinks, useQrPdfExport } from '../../components/ScorekeeperQrCards';
import { Button } from '../../components/livebracket-ds';
import styles from './ScorekeeperQrModal.module.css';

interface ScorekeeperQrModalProps {
  slug: string;
  tournamentTitle?: string;
  onClose: () => void;
}

export default function ScorekeeperQrModal({ slug, tournamentTitle, onClose }: ScorekeeperQrModalProps) {
  const { matches, loading, error } = useScorekeeperLinks(slug);
  const { exportAll, exporting, error: exportError } = useQrPdfExport(slug);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

  return (
    <div
      className={styles.modalOverlay}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Scorekeeper QR Codes"
    >
      <div className={styles.modalContent} onClick={e => e.stopPropagation()}>
        <div className={styles.modalHeader}>
          <div className={styles.modalHeaderTitleGroup}>
            <div className={styles.modalTitleRow}>
              <QrCode size={18} />
              <h3>Scorekeeper QR</h3>
            </div>
            {tournamentTitle && <span className={styles.modalSubtitle}>{tournamentTitle}</span>}
          </div>

          <div className={styles.modalHeaderActions}>
            <Button
              variant="primary"
              size="small"
              onClick={exportAll}
              disabled={exporting || loading || matches.length === 0}
            >
              {exporting ? 'Building PDF…' : 'Export all (PDF)'}
            </Button>
            <button
              type="button"
              className={styles.modalCloseBtn}
              onClick={onClose}
              aria-label="Close modal"
            >
              <X size={20} />
            </button>
          </div>
        </div>

        <div className={styles.modalBody}>
          <p className={styles.qrNotice}>
            Next match on each court. Anyone with the link can enter scores — share it only with your scorekeeper.
          </p>

          {exportError && <p className={styles.qrError}>{exportError}</p>}
          {error && <p className={styles.qrError}>{error}</p>}

          {loading && (
            <div className={styles.qrStatusMessage}>Loading scorekeeper QR codes…</div>
          )}

          {!loading && !error && matches.length === 0 && (
            <div className={styles.qrStatusMessage}>
              No active court matches to score. Once matches are scheduled and courts are assigned, QR codes will appear here.
            </div>
          )}

          {!loading && !error && matches.length > 0 && (
            <div className={styles.qrCardsContainer}>
              <ScorekeeperQrCards matches={matches} />
            </div>
          )}

          <div className={styles.modalFootNote}>
            <Bell size={15} aria-hidden="true" />
            <span>
              Each code is unique to one match. Codes rotate when a match ends — reprint or re-scan after the round.
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
