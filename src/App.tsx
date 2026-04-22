import { useEffect } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from '@/store/auth';
import { useSettings } from '@/store/settings';
import { setMuted } from '@/lib/sounds';
import { Layout } from '@/components/Layout';
import { AuthScreen } from '@/features/auth/AuthScreen';
import { Dashboard } from '@/features/dashboard/Dashboard';
import { TournamentWizard } from '@/features/tournament/TournamentWizard';
import { TournamentLive } from '@/features/tournament/TournamentLive';
import { TournamentMonitor } from '@/features/tournament/TournamentMonitor';
import { CashGameNew } from '@/features/cash/CashGameNew';
import { CashGameLive } from '@/features/cash/CashGameLive';
import { Bank } from '@/features/bank/Bank';
import { History } from '@/features/history/History';
import { Settings } from '@/features/settings/Settings';

export default function App() {
  const { session, loading, init } = useAuth();
  const soundEnabled = useSettings((s) => s.soundEnabled);

  useEffect(() => {
    init();
  }, [init]);

  useEffect(() => {
    setMuted(!soundEnabled);
  }, [soundEnabled]);

  if (loading) {
    return (
      <div className="min-h-screen grid place-items-center">
        <div className="font-display text-3xl text-brass-shine animate-pulse">HOME POT</div>
      </div>
    );
  }

  if (!session) return <AuthScreen />;

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<Dashboard />} />
        <Route path="/tournament/new" element={<TournamentWizard />} />
        <Route path="/tournament/:id" element={<TournamentLive />} />
        <Route path="/cash/new" element={<CashGameNew />} />
        <Route path="/cash/:id" element={<CashGameLive />} />
        <Route path="/bank" element={<Bank />} />
        <Route path="/history" element={<History />} />
        <Route path="/settings" element={<Settings />} />
      </Route>
      {/* Monitor view rendered outside Layout (no nav) */}
      <Route path="/tournament/:id/monitor" element={<TournamentMonitor />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
