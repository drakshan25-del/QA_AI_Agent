import { Component, type ErrorInfo, type ReactNode } from 'react';

/**
 * App-level error boundary (AIQA-EXEC-004 class of bug): without one, ANY
 * uncaught render error unmounts the entire React tree and the user sees a
 * silent blank page. This keeps the shell alive and offers a reload, while
 * never exposing stack traces to the UI (§17 — plain-language errors).
 */
export class ErrorBoundary extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error): { error: Error } {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Log for developers; the UI shows only a plain-language message.
    console.error('Unhandled render error:', error, info.componentStack);
  }

  render(): ReactNode {
    if (!this.state.error) return this.props.children;
    return (
      <div
        role="alert"
        style={{
          maxWidth: 560,
          margin: '15vh auto',
          padding: 24,
          border: '1px solid var(--border, #30363d)',
          borderRadius: 8,
          textAlign: 'center',
        }}
      >
        <h1 style={{ fontSize: 20, marginTop: 0 }}>Something went wrong</h1>
        <p style={{ opacity: 0.8 }}>
          This page hit an unexpected error. Your data is safe — reload to
          continue, and if it happens again please report what you were doing.
        </p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          style={{
            padding: '8px 18px',
            borderRadius: 6,
            border: '1px solid var(--border, #30363d)',
            background: 'var(--accent, #2f81f7)',
            color: '#fff',
            cursor: 'pointer',
          }}
        >
          Reload page
        </button>
      </div>
    );
  }
}
