'use client';

import { useEffect, useState } from 'react';
import QRCode from 'qrcode';

interface Props {
  /** The URL the code encodes. */
  value: string;
  /** Rendered pixel size (square). @default 160 */
  size?: number;
  className?: string;
  alt?: string;
}

/* A real, scannable QR code.
 *
 * Rendered client-side to a data URL: these encode short URLs, so generation
 * is sub-millisecond and keeping it off the server avoids an image route
 * whose only job would be to hand out scorekeeper tokens. */
export default function QrCodeImage({ value, size = 160, className, alt }: Props) {
  // One piece of state, written only from the async callbacks, so rendering
  // never cascades: 'pending' until the encoder comes back either way.
  const [result, setResult] = useState<{ key: string; url: string | null }>({ key: '', url: null });

  useEffect(() => {
    let cancelled = false;
    const key = `${value}|${size}`;
    QRCode.toDataURL(value, {
      width: size * 2, // 2x so it stays crisp on retina and when printed
      margin: 1,
      errorCorrectionLevel: 'M',
      color: { dark: '#14181E', light: '#FFFFFF' },
    })
      .then(url => { if (!cancelled) setResult({ key, url }); })
      .catch(() => { if (!cancelled) setResult({ key, url: null }); });
    return () => { cancelled = true; };
  }, [value, size]);

  const settled = result.key === `${value}|${size}`;
  const dataUrl = settled ? result.url : null;
  const failed = settled && result.url === null;

  if (failed) {
    return (
      <div
        className={className}
        style={{
          width: size, height: size, display: 'grid', placeItems: 'center',
          background: '#F3F3F3', borderRadius: 8, fontSize: 11, color: '#757575', textAlign: 'center', padding: 8,
        }}
      >
        Could not render QR
      </div>
    );
  }

  if (!dataUrl) {
    return (
      <div
        className={className}
        style={{ width: size, height: size, background: '#F3F3F3', borderRadius: 8 }}
        aria-hidden="true"
      />
    );
  }

  return (
    <img
      src={dataUrl}
      width={size}
      height={size}
      className={className}
      alt={alt ?? 'QR code'}
      style={{ display: 'block', borderRadius: 8 }}
    />
  );
}
