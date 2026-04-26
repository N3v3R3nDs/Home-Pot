import { lazy, Suspense, useEffect } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from '@/store/auth';
import { useSettings } from '@/store/settings';
import { setMuted, bindAudioUnlock } from '@/lib/sounds';
import { Layout } from '@/components/Layout';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { ConfirmProvider } from '@/components/ui/Confirm';
import { ToastProvider } from '@/components/ui/Toast';
import { UndoProvider } from '@/components/ui/Undo';
import { AuthScreen } from '@/features/auth/AuthScreen';

// Lazy-loaded routes — each becomes its own JS chunk so the initial bundle
// only includes the auth screen + dashboard. Improves first-load over LTE.
const Dashboard          = lazy(() => import('@/features/dashboard/Dashboard').then((m) => ({ default: m.Dashboard })));
const TournamentWizard   = lazy(() => import('@/features/tournament/TournamentWizard').then((m) => ({ default: m.TournamentWizard })));
const TournamentLive     = lazy(() => import('@/features/tournament/TournamentLive').then((m) => ({ default: m.TournamentLive })));
const TournamentMonitor  = lazy(() => import('@/features/tournament/TournamentMonitor').then((m) => ({ default: m.TournamentMonitor })));
const PublicTournament   = lazy(() => import('@/features/tournament/PublicView').then((m) => ({ default: m.PublicTournamentView })));
const CashGameNew        = lazy(() => import('@/features/cash/CashGameNew').then((m) => ({ default: m.CashGameNew })));
const CashGameLive       = lazy(() => import('@/features/cash/CashGameLive').then((m) => ({ default: m.CashGameLive })));
const CashGameMonitor    = lazy(() => import('@/features/cash/CashGameMonitor').then((m) => ({ default: m.CashGameMonitor })));
const PublicCash         = lazy(() => import('@/features/cash/PublicCashView').then((m) => ({ default: m.PublicCashView })));
const Bank               = lazy(() => import('@/features/bank/Bank').then((m) => ({ default: m.Bank })));
const History            = lazy(() => import('@/features/history/History').then((m) => ({ default: m.History })));
const PlayerProfile      = lazy(() => import('@/features/players/PlayerProfile').then((m) => ({ default: m.PlayerProfile })));
const Settings           = lazy(() => import('@/features/settings/Settings').then((m) => ({ default: m.Settings })));
const Status             = lazy(() => import('@/features/status/Status').then((m) => ({ default: m.Status })));

function RouteFallback() {
  return (
    <div className="min-h-[40vh] grid place-items-center">
      <div className="font-display text-2xl text-brass-shine animate-pulse">…</div>
    </div>
  );
}

export default function App() {
  const { session, loading, init } = useAuth();
  const soundEnabled = useSettings((s) => s.soundEnabled);

  useEffect(() => {
    init();
  }, [init]);

  useEffect(() => {
    setMuted(!soundEnabled);
  }, [soundEnabled]);

  useEffect(() => {
    bindAudioUnlock();
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen grid place-items-center">
        <div className="font-display text-3xl text-brass-shine animate-pulse">HOME POT</div>
      </div>
    );
  }

  if (!session) return (
    <ErrorBoundary>
      <ToastProvider>
        <Suspense fallback={<RouteFallback />}>
          <Routes>
            {/* Public spectator URL — no login needed; component anon-signs-in */}
            <Route path="/t/:code/view" element={<PublicTournament />} />
            <Route path="/c/:code/view" element={<PublicCash />} />
            <Route path="*" element={<AuthScreen />} />
          </Routes>
        </Suspense>
      </ToastProvider>
    </ErrorBoundary>
  );

  return (
    <ErrorBoundary>
    <ToastProvider>
    <ConfirmProvider>
      <UndoProvider>
        <Suspense fallback={<RouteFallback />}>
          <Routes>
            <Route element={<Layout />}>
              <Route path="/" element={<Dashboard />} />
              <Route path="/tournament/new" element={<TournamentWizard />} />
              <Route path="/tournament/:id" element={<TournamentLive />} />
              <Route path="/cash/new" element={<CashGameNew />} />
              <Route path="/cash/:id" element={<CashGameLive />} />
              <Route path="/bank" element={<Bank />} />
              <Route path="/history" element={<History />} />
              <Route path="/player/:id" element={<PlayerProfile />} />
              <Route path="/settings" element={<Settings />} />
              <Route path="/status" element={<Status />} />
            </Route>
            <Route path="/tournament/:id/monitor" element={<TournamentMonitor />} />
            <Route path="/cash/:id/monitor" element={<CashGameMonitor />} />
            <Route path="/t/:code/view" element={<PublicTournament />} />
            <Route path="/c/:code/view" element={<PublicCash />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </UndoProvider>
    </ConfirmProvider>
    </ToastProvider>
    </ErrorBoundary>
  );
}
