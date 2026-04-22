/** Tiny wrapper around the Wake Lock API for the monitor view. */

let sentinel: WakeLockSentinel | null = null;

export async function requestWakeLock(): Promise<boolean> {
  try {
    if (!('wakeLock' in navigator)) return false;
    sentinel = await (navigator as Navigator & { wakeLock: { request(t: 'screen'): Promise<WakeLockSentinel> } })
      .wakeLock.request('screen');
    sentinel.addEventListener('release', () => {
      sentinel = null;
    });
    return true;
  } catch {
    return false;
  }
}

export async function releaseWakeLock(): Promise<void> {
  try {
    await sentinel?.release();
  } catch {
    /* noop */
  }
  sentinel = null;
}

interface WakeLockSentinel extends EventTarget {
  release(): Promise<void>;
}
