import { motion } from 'framer-motion';
import { QRCode } from './QRCode';

interface JoinBadgeProps {
  /** 4-letter join code shown next to the QR. */
  code: string | null;
  /** Encoded URL for the QR. */
  url: string;
  /** Faded slightly when the host is in clean/fullscreen broadcast mode. */
  faded?: boolean;
}

/**
 * Bottom-corner "Join" badge for the monitor views. Adds a subtle 4-second
 * shine sweep across the brass border so spectators notice "yes, scan me"
 * from across the room.
 */
export function JoinBadge({ code, url, faded }: JoinBadgeProps) {
  return (
    <div
      className={`absolute z-10 bottom-2 left-2 flex items-center gap-2 bg-felt-950/85 backdrop-blur-sm border border-felt-700/60 rounded-xl p-1.5 overflow-hidden ${
        faded ? 'opacity-80 hover:opacity-100 transition' : ''
      }`}
    >
      {/* Shine sweep — slow, ambient, draws the eye every few seconds */}
      <motion.span
        aria-hidden
        className="absolute inset-y-0 -left-1/2 w-1/2 pointer-events-none"
        style={{ background: 'linear-gradient(90deg, transparent, rgba(236,208,117,0.35), transparent)' }}
        animate={{ x: ['0%', '420%'] }}
        transition={{ duration: 4.5, repeat: Infinity, ease: 'easeInOut', repeatDelay: 2.5 }}
      />
      <div className="relative text-left pl-1">
        <div className="text-[9px] uppercase tracking-[0.3em] text-brass-300 leading-none">Join</div>
        <div
          className="font-display tracking-[0.25em] text-brass-shine leading-none"
          style={{ fontSize: 'clamp(0.95rem, 3.5vmin, 1.6rem)' }}
        >
          {code ?? '—'}
        </div>
      </div>
      <div className="relative">
        <QRCode value={url} size={56} />
      </div>
    </div>
  );
}
