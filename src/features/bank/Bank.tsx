import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Sheet } from '@/components/ui/Sheet';
import { supabase } from '@/lib/supabase';
import { bankAccountKey, recordBankTx, type BankBalance, type BankTransaction } from '@/lib/bank';
import { useSettings } from '@/store/settings';
import { useAuth } from '@/store/auth';
import { formatMoney } from '@/lib/format';
import { useT } from '@/lib/i18n';
import type { Profile } from '@/types/db';

interface AccountRow extends BankBalance {
  name: string;
  avatar: string;
  key: string;
}

export function Bank() {
  const { currency } = useSettings();
  const { user } = useAuth();
  const t = useT();
  const [balances, setBalances] = useState<BankBalance[]>([]);
  const [profileMap, setProfileMap] = useState<Record<string, Profile>>({});
  const [recentTx, setRecentTx] = useState<BankTransaction[]>([]);
  const [accountTx, setAccountTx] = useState<BankTransaction[] | null>(null);
  const [openAccount, setOpenAccount] = useState<AccountRow | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [allProfiles, setAllProfiles] = useState<Profile[]>([]);
  const [draftProfile, setDraftProfile] = useState<string>('');
  const [draftGuest, setDraftGuest] = useState('');
  const [draftAmount, setDraftAmount] = useState(0);
  const [draftKind, setDraftKind] = useState<'manual_deposit' | 'manual_withdrawal'>('manual_deposit');
  const [draftNote, setDraftNote] = useState('');

  useEffect(() => {
    const load = async () => {
      const [{ data: bals }, { data: txs }, { data: profs }] = await Promise.all([
        supabase.from('bank_balances').select('*').order('balance', { ascending: false }),
        supabase.from('bank_transactions').select('*').order('created_at', { ascending: false }).limit(15),
        supabase.from('profiles').select('*').order('display_name'),
      ]);
      setBalances((bals ?? []) as BankBalance[]);
      setRecentTx((txs ?? []) as BankTransaction[]);
      setAllProfiles((profs ?? []) as Profile[]);
      setProfileMap(Object.fromEntries((profs ?? []).map((p) => [p.id, p as Profile])));
    };
    load();
    const ch = supabase.channel('bank').on('postgres_changes',
      { event: '*', schema: 'public', table: 'bank_transactions' }, load).subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);

  const accounts: AccountRow[] = useMemo(
    () => balances.map((b) => ({
      ...b,
      key: bankAccountKey(b),
      name: b.profile_id ? profileMap[b.profile_id]?.display_name ?? '…' : (b.guest_name ?? 'Guest'),
      avatar: b.profile_id ? profileMap[b.profile_id]?.avatar_emoji ?? '🃏' : '👤',
    })),
    [balances, profileMap],
  );

  const totalInBank = accounts.reduce((s, a) => s + Number(a.balance), 0);

  const openLedger = async (acc: AccountRow) => {
    setOpenAccount(acc);
    let q = supabase.from('bank_transactions').select('*').order('created_at', { ascending: false });
    if (acc.profile_id) q = q.eq('profile_id', acc.profile_id);
    else if (acc.guest_name) q = q.eq('guest_name', acc.guest_name);
    const { data } = await q;
    setAccountTx((data ?? []) as BankTransaction[]);
  };

  const submitTx = async () => {
    if (!draftAmount) return;
    const profile_id = draftProfile || undefined;
    const guest_name = !profile_id && draftGuest.trim() ? draftGuest.trim() : undefined;
    if (!profile_id && !guest_name) return;
    const signed = draftKind === 'manual_deposit' ? Math.abs(draftAmount) : -Math.abs(draftAmount);
    await recordBankTx({
      profile_id, guest_name,
      amount: signed,
      currency,
      kind: draftKind,
      note: draftNote || undefined,
      created_by: user?.id,
    });
    setShowNew(false);
    setDraftAmount(0);
    setDraftNote('');
    setDraftGuest('');
    setDraftProfile('');
  };

  return (
    <div className="space-y-4">
      <header className="flex items-end justify-between">
        <div>
          <h1 className="font-display text-3xl text-brass-shine">{t('theBank')}</h1>
          <p className="text-ink-400 text-sm mt-1">{t('bankSubtitle')}</p>
        </div>
        <Button variant="ghost" className="!px-3 !py-2 text-xs" onClick={() => setShowNew(true)}>＋ Tx</Button>
      </header>

      <Card className="text-center bg-felt-radial">
        <div className="text-[10px] uppercase tracking-[0.3em] text-brass-300">{t('totalInBank')}</div>
        <motion.div
          key={totalInBank}
          initial={{ scale: 0.95, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          className="font-display text-5xl text-brass-shine mt-2 tabular-nums"
        >
          {formatMoney(totalInBank, currency)}
        </motion.div>
        <div className="text-xs text-ink-400 mt-1">{t(accounts.length === 1 ? 'acrossAccount' : 'acrossAccounts', { n: accounts.length })}</div>
      </Card>

      <Card>
        <p className="label">{t('accounts')}</p>
        {accounts.length === 0 ? (
          <p className="text-ink-400 text-sm">{t('noBankAccounts')}</p>
        ) : (
          <ul className="divide-y divide-felt-800">
            {accounts.map((a) => (
              <li key={a.key}>
                <button
                  onClick={() => openLedger(a)}
                  className="w-full flex items-center justify-between py-3 hover:bg-felt-900/40 px-2 -mx-2 rounded-lg transition"
                >
                  <span className="flex items-center gap-3">
                    <span className="text-xl">{a.avatar}</span>
                    <span>
                      <div className="font-semibold text-left">{a.name}</div>
                      <div className="text-xs text-ink-400 text-left">{a.tx_count} tx</div>
                    </span>
                  </span>
                  <span className={`font-mono text-lg ${Number(a.balance) > 0 ? 'text-emerald-400' : Number(a.balance) < 0 ? 'text-red-400' : 'text-ink-200'}`}>
                    {Number(a.balance) >= 0 ? '+' : ''}{formatMoney(Number(a.balance), currency)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {recentTx.length > 0 && (
        <Card>
          <p className="label">{t('recentActivity')}</p>
          <ul className="space-y-1 text-sm">
            {recentTx.map((t) => {
              const name = t.profile_id
                ? profileMap[t.profile_id]?.display_name ?? '…'
                : t.guest_name ?? 'Guest';
              return (
                <li key={t.id} className="flex items-center justify-between bg-felt-950/50 rounded-lg px-3 py-2">
                  <span><b>{name}</b> · <span className="text-ink-400">{t.kind.replace(/_/g, ' ')}</span></span>
                  <span className={`font-mono ${t.amount > 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                    {t.amount > 0 ? '+' : ''}{formatMoney(t.amount, t.currency)}
                  </span>
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      {/* Manual transaction sheet */}
      <Sheet open={showNew} onClose={() => setShowNew(false)} title="Bank transaction">
        <div className="space-y-3">
          <div>
            <p className="label">Type</p>
            <div className="grid grid-cols-2 gap-2">
              {(['manual_deposit', 'manual_withdrawal'] as const).map((k) => (
                <button
                  key={k}
                  onClick={() => setDraftKind(k)}
                  className={`py-3 rounded-xl text-sm font-semibold border ${
                    draftKind === k ? 'bg-brass-500/15 border-brass-500/50 text-brass-100' : 'bg-felt-900/60 border-felt-700 text-ink-200'
                  }`}
                >
                  {k === 'manual_deposit' ? '＋ Deposit' : '− Withdraw'}
                </button>
              ))}
            </div>
          </div>
          <div>
            <p className="label">Account holder</p>
            <select
              className="input"
              value={draftProfile}
              onChange={(e) => { setDraftProfile(e.target.value); setDraftGuest(''); }}
            >
              <option value="">— guest —</option>
              {allProfiles.map((p) => (
                <option key={p.id} value={p.id}>{p.display_name}</option>
              ))}
            </select>
            {!draftProfile && (
              <Input className="mt-2" placeholder="Guest name (e.g. Lars)" value={draftGuest}
                onChange={(e) => setDraftGuest(e.target.value)} />
            )}
          </div>
          <Input label="Amount" type="number" value={draftAmount} suffix={currency}
            onChange={(e) => setDraftAmount(Number(e.target.value))} />
          <Input label="Note (optional)" value={draftNote}
            onChange={(e) => setDraftNote(e.target.value)} placeholder="e.g. paid in cash on arrival" />
          <Button full onClick={submitTx} disabled={!draftAmount || (!draftProfile && !draftGuest.trim())}>
            Record {draftKind === 'manual_deposit' ? '+' : '−'}{formatMoney(Math.abs(draftAmount), currency)}
          </Button>
        </div>
      </Sheet>

      {/* Per-account ledger */}
      <Sheet open={!!openAccount} onClose={() => { setOpenAccount(null); setAccountTx(null); }}
        title={openAccount ? `${openAccount.avatar} ${openAccount.name}` : ''}>
        {openAccount && (
          <>
            <div className="bg-felt-radial rounded-2xl p-4 text-center mb-4">
              <div className="text-[10px] uppercase tracking-widest text-brass-300">Balance</div>
              <div className={`font-display text-4xl mt-1 tabular-nums ${Number(openAccount.balance) > 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                {Number(openAccount.balance) >= 0 ? '+' : ''}{formatMoney(Number(openAccount.balance), currency)}
              </div>
            </div>
            <p className="label">Ledger</p>
            <ul className="space-y-1">
              {(accountTx ?? []).map((t) => (
                <li key={t.id} className="bg-felt-950/60 rounded-lg px-3 py-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-ink-200">{t.kind.replace(/_/g, ' ')}</span>
                    <span className={`font-mono text-sm ${t.amount > 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                      {t.amount > 0 ? '+' : ''}{formatMoney(t.amount, t.currency)}
                    </span>
                  </div>
                  <div className="text-xs text-ink-500 flex items-center justify-between">
                    <span>{new Date(t.created_at).toLocaleString('nb-NO')}</span>
                    {t.note && <span className="truncate max-w-[60%] text-right">{t.note}</span>}
                  </div>
                </li>
              ))}
              {accountTx?.length === 0 && <li className="text-ink-400 text-sm">No transactions.</li>}
            </ul>
          </>
        )}
      </Sheet>
    </div>
  );
}
