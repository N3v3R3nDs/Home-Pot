/**
 * Render a 1080×1080 PNG "podium" share card using Canvas. Uses the active
 * theme colors so the card matches the app's look. Returns a Blob.
 */

import { formatMoney, formatPlace } from './format';

interface PodiumEntry {
  place: number;
  name: string;
  prize: number;
}

interface Args {
  title: string;          // e.g. tournament name
  subtitle?: string;      // e.g. "April 23, 2026"
  podium: PodiumEntry[];  // top N (usually 1-3)
  currency: string;
}

function readVar(name: string): string {
  if (typeof document === 'undefined') return '255 255 255';
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || '255 255 255';
}

export async function renderShareCard({ title, subtitle, podium, currency }: Args): Promise<Blob> {
  const W = 1080, H = 1080;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D not supported');

  const felt950 = `rgb(${readVar('--felt-950')})`;
  const felt700 = `rgb(${readVar('--felt-700')})`;
  const brassMid = `rgb(${readVar('--shine-mid')})`;
  const brassFrom = `rgb(${readVar('--shine-from')})`;
  const ink100 = `rgb(${readVar('--ink-100')})`;
  const ink400 = `rgb(${readVar('--ink-400')})`;

  // Background — radial gradient mimicking the felt
  const bg = ctx.createRadialGradient(W / 2, -200, 100, W / 2, H / 2, H);
  bg.addColorStop(0, felt700);
  bg.addColorStop(1, felt950);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  // Top accent bar
  const accent = ctx.createLinearGradient(0, 0, W, 0);
  accent.addColorStop(0, brassFrom); accent.addColorStop(0.5, brassMid); accent.addColorStop(1, brassFrom);
  ctx.fillStyle = accent;
  ctx.fillRect(0, 0, W, 12);

  // Header
  ctx.fillStyle = brassMid;
  ctx.font = 'bold 36px "Bebas Neue", Impact, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('🃏 HOME POT', W / 2, 110);

  ctx.fillStyle = brassFrom;
  ctx.font = 'bold 80px "Bebas Neue", Impact, sans-serif';
  ctx.fillText(title.toUpperCase(), W / 2, 200);

  if (subtitle) {
    ctx.fillStyle = ink400;
    ctx.font = '32px Inter, sans-serif';
    ctx.fillText(subtitle, W / 2, 250);
  }

  // Podium — bars 2 / 1 / 3 layout
  const order = [
    podium.find((p) => p.place === 2),
    podium.find((p) => p.place === 1),
    podium.find((p) => p.place === 3),
  ];
  const barHeights = [380, 480, 320];
  const heights = order.map((p, i) => p ? barHeights[i] : 0);
  const baseY = 880;
  const colW = 280;
  const gap = 24;
  const totalW = colW * 3 + gap * 2;
  const startX = (W - totalW) / 2;

  ['🥈', '🥇', '🥉'].forEach((medal, i) => {
    const entry = order[i];
    if (!entry) return;
    const x = startX + (colW + gap) * i;
    const h = heights[i];
    const y = baseY - h;

    // Bar
    const barGrad = ctx.createLinearGradient(0, y, 0, baseY);
    barGrad.addColorStop(0, brassMid); barGrad.addColorStop(1, felt700);
    ctx.fillStyle = barGrad;
    ctx.beginPath();
    const ctxAny = ctx as CanvasRenderingContext2D & { roundRect?: (x: number, y: number, w: number, h: number, r: number) => void };
    if (typeof ctxAny.roundRect === 'function') ctxAny.roundRect(x, y, colW, h, 16);
    else (ctx as CanvasRenderingContext2D).rect(x, y, colW, h);
    ctx.fill();

    // Medal
    ctx.font = '120px serif';
    ctx.textAlign = 'center';
    ctx.fillText(medal, x + colW / 2, y + 130);

    // Name
    ctx.fillStyle = ink100;
    ctx.font = 'bold 48px Inter, sans-serif';
    ctx.fillText(entry.name, x + colW / 2, y + 220);

    // Prize
    ctx.fillStyle = brassFrom;
    ctx.font = 'bold 56px "Bebas Neue", Impact, sans-serif';
    ctx.fillText(formatMoney(entry.prize, currency), x + colW / 2, y + 290);

    // Place pill
    ctx.fillStyle = felt950;
    ctx.font = 'bold 28px Inter, sans-serif';
    ctx.fillText(formatPlace(entry.place).toUpperCase(), x + colW / 2, y + h - 24);
  });

  // Footer
  ctx.fillStyle = ink400;
  ctx.font = '24px Inter, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('home pot · poker night', W / 2, H - 30);

  return new Promise((resolve, reject) =>
    c.toBlob((b) => b ? resolve(b) : reject(new Error('blob failed')), 'image/png', 0.95));
}

/** Trigger native share or download. */
export async function shareCard(blob: Blob, filename: string, title: string): Promise<void> {
  const file = new File([blob], filename, { type: 'image/png' });
  const navAny = navigator as Navigator & { canShare?: (data: ShareData) => boolean };
  if (typeof navigator.share === 'function' && navAny.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title });
      return;
    } catch { /* user cancelled — fall through to download */ }
  }
  // Fallback: download
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}
