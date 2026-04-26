import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { NumberInput } from '@/components/ui/NumberInput';
import { useToast } from '@/components/ui/Toast';
import { useAuth } from '@/store/auth';
import { useSettings } from '@/store/settings';
import { supabase } from '@/lib/supabase';
import { generateJoinCode } from '@/lib/joinCode';
import { useSeason } from '@/store/season';

export function CashGameNew() {
  const { user } = useAuth();
  const { currency } = useSettings();
  const { activeSeasonId, setActiveSeasonId } = useSeason();
  const navigate = useNavigate();
  const toast = useToast();
  const [name, setName] = useState(`Cash game ${new Date().toLocaleDateString('nb-NO')}`);
  const [sb, setSb] = useState(5);
  const [bb, setBb] = useState(10);
  const [busy, setBusy] = useState(false);

  const create = async () => {
    if (!user || busy) return;
    setBusy(true);
    try {
      // Validate the persisted activeSeasonId — if the season was deleted
      // the FK insert would fail. Verify before using; clear if missing.
      let seasonId: string | null = activeSeasonId;
      if (seasonId) {
        const { data: season } = await supabase
          .from('seasons').select('id').eq('id', seasonId).maybeSingle();
        if (!season) {
          seasonId = null;
          setActiveSeasonId(null);
        }
      }

      let inserted: { id: string } | null = null;
      let lastError: { message: string } | null = null;
      for (let i = 0; i < 5 && !inserted; i++) {
        const code = generateJoinCode();
        const { data, error } = await supabase.from('cash_games').insert({
          host_id: user.id,
          name,
          small_blind: sb,
          big_blind: bb,
          currency,
          join_code: code,
          season_id: seasonId,
        }).select('id').single();
        if (!error && data) inserted = data as { id: string };
        else if (error) lastError = error;
      }

      if (!inserted) {
        // eslint-disable-next-line no-console
        console.error('[CashGameNew] insert failed:', lastError);
        toast(lastError?.message ?? 'Failed to create cash game', 'error');
        return;
      }
      navigate(`/cash/${inserted.id}`);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[CashGameNew] unexpected error:', e);
      toast(e instanceof Error ? e.message : 'Unexpected error', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <h1 className="font-display text-3xl text-brass-shine">New Cash Game</h1>
      <Card className="space-y-4">
        <Input label="Name" value={name} onChange={(e) => setName(e.target.value)} />
        <div className="grid grid-cols-2 gap-3">
          <NumberInput label="Small blind" value={sb} suffix={currency} min={0} required onValueChange={setSb} />
          <NumberInput label="Big blind" value={bb} suffix={currency} min={0} required onValueChange={setBb} />
        </div>
        <Button full onClick={create} disabled={busy}>{busy ? 'Creating…' : 'Start cash game'}</Button>
      </Card>
    </div>
  );
}
