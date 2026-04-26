import { useEffect, useState } from 'react';
import { Card } from '@/components/ui/Card';
import { supabase } from '@/lib/supabase';
import { useSettings } from '@/store/settings';
import { formatMoney } from '@/lib/format';
import { useConfirm } from '@/components/ui/Confirm';

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
  const confirm = useConfirm();
  const [rows, setRows] = useState<AuditRow[]>([]);
  /** Set of ref_ids whose referenced tournament/cash_game has been (soft-)deleted. */
  const [deletedRefIds, setDeletedRefIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    const load = async () => {
      const [{ data: audits }, { data: tDel }, { data: cDel }] = await Promise.all([
        supabase.from('audit_log').select('*').order('created_at', { ascending: false }).limit(20),
        supabase.from('tournaments').select('id').not('deleted_at', 'is', null),
        supabase.from('cash_games').select('id').not('deleted_at', 'is', null),
      ]);
      setRows((audits ?? []) as AuditRow[]);
      const dead = new Set<string>();
      (tDel ?? []).forEach((r) => dead.add((r as { id: string }).id));
      (cDel ?? []).forEach((r) => dead.add((r as { id: string }).id));
      setDeletedRefIds(dead);
    };
    load();
    const ch = supabase.channel(`audit_feed:${crypto.randomUUID()}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'audit_log' },
        (p) => setRows((prev) => [p.new as AuditRow, ...prev].slice(0, 20)))
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'audit_log' },
        (p) => setRows((prev) => prev.filter((r) => r.id !== (p.old as AuditRow).id)))
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'tournaments' },
        (p) => {
          const row = p.new as { id: string; deleted_at: string | null };
          setDeletedRefIds((prev) => {
            const next = new Set(prev);
            if (row.deleted_at) next.add(row.id); else next.delete(row.id);
            return next;
          });
        })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'cash_games' },
        (p) => {
          const row = p.new as { id: string; deleted_at: string | null };
          setDeletedRefIds((prev) => {
            const next = new Set(prev);
            if (row.deleted_at) next.add(row.id); else next.delete(row.id);
            return next;
          });
        })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);

  const dismiss = async (id: number) => {
    if (!await confirm({
      title: 'Dismiss this activity entry?',
      message: 'It will be permanently removed from the audit log.',
      confirmLabel: 'Dismiss',
      destructive: true,
    })) return;
    setRows((prev) => prev.filter((r) => r.id !== id));
    await supabase.from('audit_log').delete().eq('id', id);
  };

  // Hide rows that reference a deleted entity, EXCEPT keep the actual
  // ".deleted" event row (it's the audit record OF the deletion).
  const visible = rows.filter((r) => {
    if (!r.ref_id) return true;
    if (r.action.endsWith('.deleted')) return true;
    return !deletedRefIds.has(r.ref_id);
  }).slice(0, 8);

  if (visible.length === 0) return null;

  return (
    <Card>
      <p className="label">Recent activity</p>
      <ul className="space-y-1.5">
        {visible.map((r) => (
          <li key={r.id} className="flex items-center gap-2 text-sm group">
            <span className="text-base shrink-0 w-5 text-center">{ICONS[r.action] ?? '•'}</span>
            <span className="flex-1 truncate text-ink-200">{describe(r, currency)}</span>
            <span className="text-[10px] text-ink-500 shrink-0">{relativeTime(r.created_at)}</span>
            <button
              onClick={() => dismiss(r.id)}
              className="text-ink-500 hover:text-red-400 px-1 text-base leading-none"
              title="Dismiss"
            >×</button>
          </li>
        ))}
      </ul>
    </Card>
  );
}
