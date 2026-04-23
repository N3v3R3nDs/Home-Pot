import { useEffect, useState } from 'react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Sheet } from '@/components/ui/Sheet';
import { useToast } from '@/components/ui/Toast';
import { useConfirm } from '@/components/ui/Confirm';
import { supabase } from '@/lib/supabase';
import { useSeason } from '@/store/season';
import type { Season } from '@/types/db';

/** Mini admin for seasons — used inside Settings. Create / activate / delete. */
export function SeasonAdmin() {
  const toast = useToast();
  const confirm = useConfirm();
  const { activeSeasonId, setActiveSeasonId } = useSeason();
  const [seasons, setSeasons] = useState<Season[]>([]);
  const [show, setShow] = useState(false);
  const [name, setName] = useState('');
  const [start, setStart] = useState(new Date().toISOString().slice(0, 10));
  const [end, setEnd] = useState(() => {
    const d = new Date(); d.setMonth(d.getMonth() + 3);
    return d.toISOString().slice(0, 10);
  });

  useEffect(() => {
    const load = async () => {
      const { data } = await supabase.from('seasons').select('*').order('starts_on', { ascending: false });
      setSeasons((data ?? []) as Season[]);
    };
    load();
    const ch = supabase.channel('seasons').on('postgres_changes',
      { event: '*', schema: 'public', table: 'seasons' }, load).subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);

  const create = async () => {
    if (!name.trim()) { toast('Name is required', 'error'); return; }
    const { data, error } = await supabase.from('seasons')
      .insert({ name: name.trim(), starts_on: start, ends_on: end })
      .select().single();
    if (error) { toast(error.message, 'error'); return; }
    toast(`Season "${data.name}" created 🎯`, 'success');
    setActiveSeasonId(data.id as string);
    setShow(false); setName('');
  };

  const remove = async (s: Season) => {
    if (!await confirm({
      title: `Delete "${s.name}"?`,
      message: 'Tournaments and cash games already linked to this season will be unlinked. Their data is preserved.',
      destructive: true,
      confirmLabel: 'Delete',
    })) return;
    await supabase.from('seasons').delete().eq('id', s.id);
    if (activeSeasonId === s.id) setActiveSeasonId(null);
  };

  return (
    <Card>
      <div className="flex items-center justify-between mb-2">
        <p className="label !mb-0">Seasons</p>
        <Button variant="ghost" className="!px-3 !py-1.5 text-xs" onClick={() => setShow(true)}>＋ New season</Button>
      </div>
      <p className="text-xs text-ink-400 mb-3">
        Stats can be scoped to a season. Pick "All time" anytime to see everything.
      </p>
      <ul className="space-y-1.5">
        <li>
          <button
            onClick={() => setActiveSeasonId(null)}
            className={`w-full text-left flex items-center justify-between rounded-lg px-3 py-2 ${
              activeSeasonId === null ? 'bg-brass-500/15 border border-brass-500/40' : 'bg-felt-950/40'
            }`}
          >
            <span className="text-sm">All time</span>
            {activeSeasonId === null && <span className="text-brass-300 text-xs">active</span>}
          </button>
        </li>
        {seasons.map((s) => (
          <li key={s.id} className="flex items-center gap-2">
            <button
              onClick={() => setActiveSeasonId(s.id)}
              className={`flex-1 text-left flex items-center justify-between rounded-lg px-3 py-2 ${
                activeSeasonId === s.id ? 'bg-brass-500/15 border border-brass-500/40' : 'bg-felt-950/40'
              }`}
            >
              <span>
                <div className="font-semibold text-sm">{s.name}</div>
                <div className="text-[10px] text-ink-400">
                  {new Date(s.starts_on).toLocaleDateString('nb-NO')} – {new Date(s.ends_on).toLocaleDateString('nb-NO')}
                </div>
              </span>
              {activeSeasonId === s.id && <span className="text-brass-300 text-xs">active</span>}
            </button>
            <button onClick={() => remove(s)} className="text-red-400/70 hover:text-red-400 text-lg">×</button>
          </li>
        ))}
      </ul>

      <Sheet open={show} onClose={() => setShow(false)} title="New season">
        <Input label="Name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Spring 2026" autoFocus />
        <div className="grid grid-cols-2 gap-3 mt-3">
          <Input label="Start" type="date" value={start} onChange={(e) => setStart(e.target.value)} />
          <Input label="End"   type="date" value={end}   onChange={(e) => setEnd(e.target.value)} />
        </div>
        <Button full className="mt-4" onClick={create}>Create season</Button>
      </Sheet>
    </Card>
  );
}
