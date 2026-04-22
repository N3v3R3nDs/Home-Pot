import { CHIP_COLORS, type Denomination } from '@/lib/chipSet';
import { cn } from '@/lib/cn';

interface ChipProps {
  denom: Denomination;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

const SIZES = {
  sm: 'w-7 h-7 text-[8px]',
  md: 'w-10 h-10 text-[10px]',
  lg: 'w-14 h-14 text-sm',
} as const;

/** Stylised poker chip with stripes & a center value badge. */
export function Chip({ denom, size = 'md', className }: ChipProps) {
  const color = CHIP_COLORS[denom];
  const label = denom >= 1000 ? `${denom / 1000}K` : `${denom}`;
  return (
    <div
      className={cn(
        'relative rounded-full flex items-center justify-center font-bold text-white shadow-md select-none',
        SIZES[size],
        className,
      )}
      style={{
        background: `radial-gradient(circle at 30% 30%, ${color}cc 0%, ${color} 60%, ${color}80 100%)`,
        border: `2px dashed rgba(255,255,255,0.6)`,
        boxShadow: `0 2px 8px rgba(0,0,0,0.4), inset 0 -2px 4px rgba(0,0,0,0.3)`,
      }}
    >
      <span className="rounded-full bg-black/40 px-1.5 py-0.5 leading-none tabular-nums">
        {label}
      </span>
    </div>
  );
}
