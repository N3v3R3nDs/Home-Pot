import { useEffect, useState } from 'react';
import QR from 'qrcode';
import { cn } from '@/lib/cn';

interface QRCodeProps {
  value: string;
  size?: number;
  className?: string;
}

/** Renders a high-contrast QR code as an inline SVG via the `qrcode` package. */
export function QRCode({ value, size = 192, className }: QRCodeProps) {
  const [svg, setSvg] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    QR.toString(value, {
      type: 'svg',
      errorCorrectionLevel: 'M',
      margin: 1,
      color: { dark: '#06190d', light: '#f4e2a8' },
    }).then((markup) => {
      if (!cancelled) setSvg(markup);
    });
    return () => { cancelled = true; };
  }, [value]);

  return (
    <div
      className={cn('rounded-xl overflow-hidden bg-brass-100 p-1 shadow-glow', className)}
      style={{ width: size, height: size }}
      dangerouslySetInnerHTML={svg ? { __html: svg } : undefined}
      aria-label={`QR code for ${value}`}
    />
  );
}
