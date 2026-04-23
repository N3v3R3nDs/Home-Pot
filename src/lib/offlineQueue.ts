/**
 * Tiny offline mutation queue. Wrap a Supabase write that you want to survive
 * a brief offline blip:
 *
 *   await runOnline('rebuy-' + p.id, () => supabase.from(...).update(...));
 *
 * If offline (or the call rejects with a network-ish error), the operation is
 * stashed in localStorage and replayed when the browser regains connectivity.
 *
 * Caveats:
 *  - Functions are serialized as their string keys + payload, so we can only
 *    queue *named* writes registered via `registerHandler()`. Closures aren't
 *    preserved across reloads.
 *  - Best-effort, not transactional. For a club app this is fine.
 */

import { supabase } from './supabase';

type Handler = (payload: unknown) => Promise<void>;
const handlers = new Map<string, Handler>();
const STORAGE_KEY = 'home-pot-offline-queue';

interface QueuedItem { id: string; handler: string; payload: unknown; tries: number; }

function load(): QueuedItem[] {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]') as QueuedItem[]; }
  catch { return []; }
}
function save(items: QueuedItem[]) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(items)); }
  catch { /* noop */ }
}
function isNetworkError(e: unknown): boolean {
  const msg = (e instanceof Error ? e.message : String(e ?? '')).toLowerCase();
  return msg.includes('failed to fetch') || msg.includes('network') || msg.includes('typeerror');
}

export function registerHandler(name: string, fn: Handler): void {
  handlers.set(name, fn);
}

/** Run a registered handler online; queue if offline / network error. */
export async function enqueue(name: string, payload: unknown): Promise<void> {
  const fn = handlers.get(name);
  if (!fn) throw new Error(`No handler registered for "${name}"`);
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    queueIt(name, payload);
    return;
  }
  try { await fn(payload); }
  catch (e) {
    if (isNetworkError(e)) queueIt(name, payload);
    else throw e;
  }
}

function queueIt(name: string, payload: unknown): void {
  const items = load();
  items.push({ id: crypto.randomUUID(), handler: name, payload, tries: 0 });
  save(items);
}

export async function flushQueue(): Promise<{ ok: number; failed: number }> {
  let ok = 0, failed = 0;
  let items = load();
  if (items.length === 0) return { ok, failed };
  const remaining: QueuedItem[] = [];
  for (const it of items) {
    const fn = handlers.get(it.handler);
    if (!fn) { remaining.push(it); continue; }
    try {
      await fn(it.payload);
      ok += 1;
    } catch (e) {
      it.tries += 1;
      if (it.tries < 5 && isNetworkError(e)) remaining.push(it);
      else failed += 1;  // give up after 5 tries or non-network error
    }
  }
  save(remaining);
  items = remaining;
  return { ok, failed };
}

/** Wire window event listeners to auto-flush when we regain connectivity. */
export function startQueueWorker(): void {
  if (typeof window === 'undefined') return;
  const tryFlush = () => { void flushQueue(); };
  window.addEventListener('online', tryFlush);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') tryFlush();
  });
  // Also try once at boot in case there's leftover queue from last session.
  tryFlush();
}

// Pre-register a generic "supabase.update" handler covering the most common
// case: { table, match: { id }, patch }
registerHandler('supabase.update', async (payload) => {
  const { table, match, patch } = payload as { table: string; match: Record<string, unknown>; patch: Record<string, unknown> };
  let q = supabase.from(table).update(patch);
  for (const [k, v] of Object.entries(match)) q = q.eq(k, v as never);
  const { error } = await q;
  if (error) throw error;
});

registerHandler('supabase.insert', async (payload) => {
  const { table, row } = payload as { table: string; row: Record<string, unknown> };
  const { error } = await supabase.from(table).insert(row);
  if (error) throw error;
});
