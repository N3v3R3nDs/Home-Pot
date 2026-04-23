import { useEffect, useState } from 'react';
import { Card } from '@/components/ui/Card';
import { supabase } from '@/lib/supabase';
import { useSettings } from '@/store/settings';
import { formatMoney } from '@/lib/format';

interface AuditRow {
  id: number;
  actor_id: string | null;
  actor_name: string | null;
  action: string;
  ref_table: string | null;
  ref_id: string | null;
  details: Record<string, unknown> | null;
  created_at: string;
}

const ICONS: Record<string, string> = {
  'tournament.finished': '🏁',
  'tournament.deleted': '🗑',
  'cash_game.finished': '🏁',
  'cash_game.deleted': '🗑',
  'bank.manual_deposit': '💰',
  'bank.manual_withdrawal': '💸',
};

function describe(row: AuditRow, currency: string): string {
  const actor = row.actor_name ?? 'Someone';
  const d = row.details ?? {};
  switch (row.action) {
    case 'tournament.finished': return `${actor} ended ${d.name ?? 'a tournament'}`;
    case 'tournament.deleted':  return `${actor} deleted ${d.name ?? 'a tournament'}`;
    case 'cash_game.finished':  return `${actor} ended ${d.name ?? 'a cash game'}`;
    case 'cash_game.deleted':   return `${actor} deleted ${d.name ?? 'a cash game'}`;
    case 'bank.manual_deposit':
      return `${actor} deposited ${formatMoney(Number(d.amount ?? 0), currency)} → ${d.guest_name ?? '🃏'}`;
    case 'bank.manual_withdrawal':
      return `${actor} withdrew ${formatMoney(Math.abs(Number(d.amount ?? 0)), currency)} ← ${d.guest_name ?? '🃏'}`;
    default: return `${actor} · ${row.action}`;
  }
}

function relativeTime(iso: string): string {
  const ms = Date.now() - Date.parse(iso);
  const m = Math.floor(ms / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

export function ActivityFeed() {
  const { currency } = useSettings();
  const [rows, setRows] = useState<AuditRow[]>([]);

  useEffect(() => {
    const load = async () => {
      const { data } = await supabase
        .from('audit_log')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(8);
      setRows((data ?? []) as AuditRow[]);
    };
    load();
    const ch = supabase.channel('audit_feed')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'audit_log' },
        (p) => setRows((prev) => [p.new as AuditRow, ...prev].slice(0, 8)))
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);

  if (rows.length === 0) return null;

  return (
    <Card>
      <p className="label">Recent activity</p>
      <ul className="space-y-1.5">
        {rows.map((r) => (
          <li key={r.id} className="flex items-center gap-3 text-sm">
            <span className="text-base shrink-0 w-5 text-center">{ICONS[r.action] ?? '•'}</span>
            <span className="flex-1 truncate text-ink-200">{describe(r, currency)}</span>
            <span className="text-[10px] text-ink-500 shrink-0">{relativeTime(r.created_at)}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}
