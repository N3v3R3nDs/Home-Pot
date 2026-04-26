import { motion } from 'framer-motion';
import type { PlayerStats } from './cashStats';

interface VirtualTableProps {
  /** Currently seated players. The table renders all of them around an oval. */
  seated: PlayerStats[];
  /** Currency for the small per-seat invested label. */
  currency: string;
  /** Total ms session has been running (drives a faint table-glow pulse). */
  sessionDurationMs?: number;
}

/**
 * SVG poker felt with seats arranged around an oval. Each seat is a chip
 * stack scaled by the player's total invested vs the biggest stake.
 *
 * Honest about what we know: invested totals are real (not chip stacks).
 * The "size" of the chip stack here represents how much they've put in,
 * not how much they're sitting on — the legend label makes that clear.
 */
export function VirtualTable({ seated, currency }: VirtualTableProps) {
  const W = 800, H = 460;
  const cx = W / 2, cy = H / 2;
  const rx = W * 0.42, ry = H * 0.34;

  const max = Math.max(1, ...seated.map((s) => s.totalIn));

  return (
    <div className="relative w-full max-w-[680px] mx-auto">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto">
        <defs>
          <radialGradient id="felt-grad" cx="50%" cy="40%" r="60%">
            <stop offset="0%" stopColor="#1a4f2c" />
            <stop offset="60%" stopColor="#0f3b1f" />
            <stop offset="100%" stopColor="#06190d" />
          </radialGradient>
          <linearGradient id="brass-rail" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#ecd075" />
            <stop offset="50%" stopColor="#d8a920" />
            <stop offset="100%" stopColor="#bf9013" />
          </linearGradient>
        </defs>

        {/* Brass rail (outer ellipse) */}
        <ellipse cx={cx} cy={cy} rx={rx + 20} ry={ry + 20} fill="url(#brass-rail)" opacity="0.55" />
        {/* Felt */}
        <ellipse cx={cx} cy={cy} rx={rx} ry={ry} fill="url(#felt-grad)" stroke="#0a2914" strokeWidth="2" />
        {/* Inner highlight */}
        <ellipse cx={cx} cy={cy - 18} rx={rx * 0.86} ry={ry * 0.7} fill="none" stroke="rgba(236,208,117,0.10)" strokeWidth="1.5" />

        {/* Center logo */}
        <text
          x={cx}
          y={cy + 6}
          textAnchor="middle"
          className="font-display"
          fontSize="40"
          fill="rgba(236,208,117,0.32)"
          letterSpacing="6"
        >
          HOME POT
        </text>
      </svg>

      {/* Seats — overlay positioned with absolute via percentages of the SVG box */}
      <div className="absolute inset-0">
        {seated.map((p, i) => {
          const angle = -Math.PI / 2 + (i / Math.max(seated.length, 1)) * Math.PI * 2;
          const x = 50 + 45 * Math.cos(angle); // % of width
          const y = 50 + 40 * Math.sin(angle); // % of height
          const ratio = p.totalIn / max;
          const stackSize = 26 + ratio * 30; // px diameter
          return (
            <motion.div
              key={p.player.id}
              layout
              initial={{ opacity: 0, scale: 0.6 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.4 }}
              transition={{ type: 'spring', stiffness: 220, damping: 22 }}
              className="absolute -translate-x-1/2 -translate-y-1/2 flex flex-col items-center gap-1"
              style={{ left: `${x}%`, top: `${y}%` }}
            >
              {/* Chip stack glyph (concentric brass rings) */}
              <div
                className="relative rounded-full shadow-glow"
                style={{
                  width: stackSize,
                  height: stackSize,
                  background: 'radial-gradient(circle at 30% 30%, #f6deaa 0%, #d8a920 55%, #8e6a0e 100%)',
                  border: '2px solid rgba(6,25,13,0.6)',
                }}
              >
                <div
                  className="absolute inset-1 rounded-full"
                  style={{ border: '1.5px dashed rgba(6,25,13,0.45)' }}
                />
              </div>
              <div className="text-[10px] font-display text-brass-shine tracking-wider whitespace-nowrap">
                {p.avatar} {p.name}
              </div>
              <div className="text-[9px] text-ink-300 tabular-nums">
                {currency} {Math.round(p.totalIn).toLocaleString()}
                {p.topUps > 0 && <span className="text-brass-300 ml-1">🪙{p.topUps}</span>}
              </div>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}
