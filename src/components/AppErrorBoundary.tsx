import { Component, type ErrorInfo, type ReactNode } from "react";

// A page that hits an unexpected problem used to leave a blank screen. This shows a calm message with a way forward instead. It never shows
// the technical error to the visitor (it goes to the browser console for whoever is debugging), and store pages keep their own light look.
type Props = { children: ReactNode };
type State = { failed: boolean };

export class AppErrorBoundary extends Component<Props, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State { return { failed: true }; }

  componentDidCatch(error: Error, info: ErrorInfo) { console.error("Page error:", error, info.componentStack); }

  render() {
    if (!this.state.failed) return this.props.children;
    const path = window.location.pathname;
    const isStore = path.startsWith("/store");
    const storeRoot = isStore ? `/${path.split("/").filter(Boolean).slice(0, 2).join("/")}` : "/";
    return (
      <main className={`nxq-page${isStore ? " store-theme" : ""}`}>
        <section className="portal-shell">
          <div className="panel panel-wide" role="alert" data-testid="app-error-fallback">
            <h1>Something went wrong</h1>
            <p>This page ran into a problem. Anything you already saved is safe. Please reload the page, and if it keeps happening, let us know what you were doing when it appeared.</p>
            <div className="settings-grid">
              <button className="wide-btn" type="button" onClick={() => window.location.reload()}>Reload this page</button>
              <a className="icon-btn" href={storeRoot}>{isStore ? "Back to the store" : "Go to the home page"}</a>
            </div>
          </div>
        </section>
      </main>
    );
  }
}
