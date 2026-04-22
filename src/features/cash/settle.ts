/**
 * Greedy minimum-transactions settler.
 * Given each participant's net (positive = they're owed; negative = they owe),
 * returns a list of payments that net everyone to zero in (close to) the
 * fewest transfers. For typical home-game sizes (≤ ~12) this is optimal in
 * practice and far simpler than the exact NP-hard solution.
 */

export interface NetPosition {
  id: string;
  name: string;
  net: number; // positive = owed, negative = owes
}

export interface Settlement {
  fromId: string;
  fromName: string;
  toId: string;
  toName: string;
  amount: number;
}

export function computeSettlements(positions: NetPosition[]): Settlement[] {
  const eps = 0.01;
  // Work on copies, sorted from biggest debtor to biggest creditor each iteration
  const debtors = positions.filter((p) => p.net < -eps).map((p) => ({ ...p }));
  const creditors = positions.filter((p) => p.net > eps).map((p) => ({ ...p }));
  debtors.sort((a, b) => a.net - b.net);    // most negative first
  creditors.sort((a, b) => b.net - a.net);  // most positive first

  const out: Settlement[] = [];
  let di = 0, ci = 0;
  while (di < debtors.length && ci < creditors.length) {
    const d = debtors[di];
    const c = creditors[ci];
    const amount = Math.min(-d.net, c.net);
    if (amount > eps) {
      out.push({
        fromId: d.id, fromName: d.name,
        toId: c.id, toName: c.name,
        amount: Math.round(amount * 100) / 100,
      });
      d.net += amount;
      c.net -= amount;
    }
    if (Math.abs(d.net) < eps) di++;
    if (Math.abs(c.net) < eps) ci++;
  }
  return out;
}
