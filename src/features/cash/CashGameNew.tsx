import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { useAuth } from '@/store/auth';
import { useSettings } from '@/store/settings';
import { supabase } from '@/lib/supabase';
import { generateJoinCode } from '@/lib/joinCode';

export function CashGameNew() {
  const { user } = useAuth();
  const { currency } = useSettings();
  const navigate = useNavigate();
  const [name, setName] = useState(`Cash game ${new Date().toLocaleDateString('nb-NO')}`);
  const [sb, setSb] = useState(5);
  const [bb, setBb] = useState(10);
  const [busy, setBusy] = useState(false);

  const create = async () => {
    if (!user) return;
    setBusy(true);
    let data: { id: string } | null = null;
    let error: unknown = null;
    for (let i = 0; i < 5 && !data; i++) {
      const code = generateJoinCode();
      const res = await supabase.from('cash_games').insert({
        host_id: user.id,
        name,
        small_blind: sb,
        big_blind: bb,
        currency,
        join_code: code,
      }).select().single();
      if (!res.error) data = res.data as { id: string };
      else error = res.error;
    }
    setBusy(false);
    if (!data) { alert((error as Error | undefined)?.message ?? 'Failed'); return; }
    navigate(`/cash/${data.id}`);
  };

  return (
    <div className="space-y-4">
      <h1 className="font-display text-3xl text-brass-shine">New Cash Game</h1>
      <Card className="space-y-4">
        <Input label="Name" value={name} onChange={(e) => setName(e.target.value)} />
        <div className="grid grid-cols-2 gap-3">
          <Input label="Small blind" type="number" value={sb} suffix={currency}
            onChange={(e) => setSb(Number(e.target.value))} />
          <Input label="Big blind" type="number" value={bb} suffix={currency}
            onChange={(e) => setBb(Number(e.target.value))} />
        </div>
        <Button full onClick={create} disabled={busy}>{busy ? 'Creating…' : 'Start cash game'}</Button>
      </Card>
    </div>
  );
}
