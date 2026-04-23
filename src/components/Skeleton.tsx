import { cn } from '@/lib/cn';

export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn('animate-pulse rounded-lg bg-felt-800/60', className)}
      style={{ animationDuration: '1.4s' }}
    />
  );
}

export function SkeletonRow() {
  return (
    <div className="flex items-center gap-3 py-2">
      <Skeleton className="w-10 h-10 rounded-full" />
      <div className="flex-1 space-y-1.5">
        <Skeleton className="h-3 w-32" />
        <Skeleton className="h-2 w-20" />
      </div>
      <Skeleton className="h-3 w-12" />
    </div>
  );
}
