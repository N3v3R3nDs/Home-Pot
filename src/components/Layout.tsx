import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { motion } from 'framer-motion';
import { cn } from '@/lib/cn';
import { useAuth } from '@/store/auth';
import { useT } from '@/lib/i18n';

export function Layout() {
  const { profile } = useAuth();
  const location = useLocation();
  const hideNav = location.pathname.includes('/monitor');
  const t = useT();
  const NAV = [
    { to: '/', label: t('navHome'), icon: '🏠' },
    { to: '/bank', label: t('navBank'), icon: '🏦' },
    { to: '/history', label: t('navStats'), icon: '📈' },
    { to: '/settings', label: t('navSettings'), icon: '⚙️' },
  ] as const;

  return (
    <div className="min-h-full flex flex-col">
      <header className="sticky top-0 z-30 bg-felt-950/80 backdrop-blur-md border-b border-felt-800/60 pt-safe">
        <div className="mx-auto max-w-2xl flex items-center justify-between px-4 h-14">
          <Link to="/" className="flex items-center gap-2">
            <motion.div
              className="w-8 h-8 rounded-lg bg-felt-radial border border-brass-500/30 grid place-items-center font-display text-brass-300 text-lg shadow-glow"
              initial={{ rotate: -8 }}
              animate={{ rotate: 0 }}
              transition={{ type: 'spring', stiffness: 200, damping: 15 }}
            >
              HP
            </motion.div>
            <span className="font-display text-xl tracking-wide text-brass-shine">Home Pot</span>
          </Link>
          {profile && (
            <Link
              to="/settings"
              className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-felt-800/70 border border-felt-700/60 text-sm"
            >
              <span className="text-base leading-none">{profile.avatar_emoji ?? '🃏'}</span>
              <span className="text-ink-100">{profile.display_name}</span>
            </Link>
          )}
        </div>
      </header>

      <main className="flex-1 mx-auto w-full max-w-2xl px-4 py-5 pb-32">
        <Outlet />
      </main>

      {!hideNav && (
        <nav className="fixed bottom-0 inset-x-0 z-30 border-t border-felt-800/60 bg-felt-950/90 backdrop-blur-md pb-safe">
          <div className="mx-auto max-w-2xl flex items-stretch justify-around">
            {NAV.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === '/'}
                className={({ isActive }) =>
                  cn(
                    'flex-1 flex flex-col items-center justify-center gap-1 py-3 text-xs font-semibold transition',
                    isActive ? 'text-brass-300' : 'text-ink-400 hover:text-ink-200',
                  )
                }
              >
                <span className="text-xl leading-none">{item.icon}</span>
                <span>{item.label}</span>
              </NavLink>
            ))}
          </div>
        </nav>
      )}
    </div>
  );
}
