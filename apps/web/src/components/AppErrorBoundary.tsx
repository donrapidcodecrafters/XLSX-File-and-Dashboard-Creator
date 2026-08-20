import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

// Without this, any uncaught render error anywhere in the tree unmounts the
// whole app to a blank black screen with no way to recover but a hard reload.
export class AppErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Unhandled render error:", error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{
          minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center",
          padding: 24, fontFamily: "'Inter', 'Segoe UI', system-ui, sans-serif",
          background: "var(--surface, #fff)", color: "var(--text, #111827)",
        }}>
          <div style={{ maxWidth: 440, textAlign: "center" }}>
            <h1 style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>Something went wrong</h1>
            <p style={{ fontSize: 13, color: "var(--text-soft, #6B7280)", lineHeight: 1.6, marginBottom: 16 }}>
              An unexpected error interrupted the page. Your data is safe — reloading usually fixes this.
            </p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              style={{
                padding: "9px 18px", borderRadius: 8, border: "none",
                background: "var(--brand, #0d7c66)", color: "#fff",
                fontSize: 13, fontWeight: 700, cursor: "pointer",
              }}
            >Reload page</button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
