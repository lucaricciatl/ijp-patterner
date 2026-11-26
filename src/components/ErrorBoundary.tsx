import { Component, type ErrorInfo, type ReactNode } from 'react';

type Props = { children: ReactNode };
type State = { error: Error | null };

/** A render error must never leave a blank window with unsaved work behind it. */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('render error', error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div style={{ padding: 40, fontFamily: 'system-ui, sans-serif', color: '#dbe6f0', background: '#080c10', height: '100%' }}>
        <h1 style={{ fontSize: 18, marginBottom: 10 }}>Something went wrong in the editor</h1>
        <p style={{ color: '#9fb2c3', lineHeight: 1.6, maxWidth: 640 }}>
          {this.state.error.message}
        </p>
        <button
          onClick={() => window.location.reload()}
          style={{ marginTop: 14, padding: '8px 14px', borderRadius: 6, border: '1px solid #2a3a4a', background: '#121a22', color: '#dbe6f0', cursor: 'pointer' }}
        >
          Reload the app
        </button>
      </div>
    );
  }
}
