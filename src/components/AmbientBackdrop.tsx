import { useEffect, useRef } from 'react';

interface AmbientBackdropProps {
  /** "felt" = green/brass embers (tournament). "cash" = warmer brass tones. */
  variant?: 'felt' | 'cash';
  /** Reduce density on weaker devices. */
  density?: 'low' | 'normal';
}

/**
 * Subtle living backdrop for the monitor views — slow-drifting conic
 * gradient plus a sparse Canvas of floating ember-points. Difference
 * between a screensaver and a TV broadcast.
 *
 * Pinned absolutely behind the content (z-0). Pointer-events disabled.
 * Respects prefers-reduced-motion (renders as a static gradient only).
 */
export function AmbientBackdrop({ variant = 'felt', density = 'normal' }: AmbientBackdropProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let raf = 0;
    let cancelled = false;

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      canvas.width = canvas.clientWidth * dpr;
      canvas.height = canvas.clientHeight * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener('resize', resize);

    const colors = variant === 'cash'
      ? ['rgba(236, 208, 117, 0.22)', 'rgba(216, 169, 32, 0.18)', 'rgba(191, 144, 19, 0.14)']
      : ['rgba(236, 208, 117, 0.18)', 'rgba(120, 200, 140, 0.12)', 'rgba(216, 169, 32, 0.14)'];

    const count = density === 'low' ? 14 : 28;
    const embers = Array.from({ length: count }, () => ({
      x: Math.random() * canvas.clientWidth,
      y: Math.random() * canvas.clientHeight,
      r: 1 + Math.random() * 2.5,
      vy: -(0.05 + Math.random() * 0.18),
      vx: (Math.random() - 0.5) * 0.08,
      hue: colors[Math.floor(Math.random() * colors.length)],
      twinkle: Math.random() * Math.PI * 2,
    }));

    const tick = () => {
      if (cancelled) return;
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      ctx.clearRect(0, 0, w, h);

      for (const e of embers) {
        e.x += e.vx;
        e.y += e.vy;
        e.twinkle += 0.015;
        if (e.y < -10) { e.y = h + 10; e.x = Math.random() * w; }
        if (e.x < -10) e.x = w + 10;
        if (e.x > w + 10) e.x = -10;

        const alpha = 0.55 + 0.45 * Math.sin(e.twinkle);
        ctx.beginPath();
        ctx.fillStyle = e.hue.replace(/[\d.]+\)$/, `${(alpha * 0.5).toFixed(2)})`);
        ctx.arc(e.x, e.y, e.r, 0, Math.PI * 2);
        ctx.fill();
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
    };
  }, [variant, density]);

  return (
    <div className="pointer-events-none absolute inset-0 z-0 overflow-hidden">
      {/* Slow-drifting conic gradient — gives the felt a living gloss */}
      <div
        className="absolute -inset-[20%] opacity-60 mix-blend-screen"
        style={{
          background: variant === 'cash'
            ? 'conic-gradient(from 0deg at 50% 50%, transparent, rgba(216,169,32,0.10), transparent, rgba(191,144,19,0.06), transparent)'
            : 'conic-gradient(from 0deg at 50% 50%, transparent, rgba(120,200,140,0.08), transparent, rgba(216,169,32,0.08), transparent)',
          animation: 'ambient-drift 60s linear infinite',
        }}
      />
      <canvas
        ref={canvasRef}
        className="absolute inset-0 w-full h-full"
        aria-hidden
      />
      <style>{`
        @keyframes ambient-drift {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
