import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props { children: ReactNode; }
interface State { error: Error | null; }

/** Last-resort error boundary so a render bug shows a friendly card instead
 *  of a blank white screen. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State { return { error }; }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // eslint-disable-next-line no-console
    console.error('[Home Pot] render error:', error, info);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="min-h-screen grid place-items-center px-6 pt-safe pb-safe">
        <div className="card-felt p-6 max-w-md w-full text-center">
          <div className="text-5xl mb-3">🃏</div>
          <h1 className="font-display text-2xl text-brass-shine mb-2">Something went off</h1>
          <p className="text-ink-300 text-sm mb-4">
            The screen hit an error. Reloading usually fixes it.
          </p>
          <pre className="text-[10px] text-left text-ink-500 bg-felt-950/70 rounded-lg p-2 mb-4 overflow-x-auto">
            {this.state.error.message}
          </pre>
          <button
            onClick={() => window.location.reload()}
            className="btn-primary w-full"
          >Reload</button>
        </div>
      </div>
    );
  }
}
