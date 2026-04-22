import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import './index.css';
import { applyTheme, type ThemeId } from './lib/themes';

// Apply persisted theme before first paint to avoid a flash.
try {
  const raw = localStorage.getItem('home-pot-settings');
  if (raw) {
    const parsed = JSON.parse(raw) as { state?: { theme?: ThemeId } };
    if (parsed.state?.theme) applyTheme(parsed.state.theme);
  }
} catch { /* noop */ }

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>,
);
