import { useIsAuthenticated, useMsal } from "@azure/msal-react";
import { InteractionStatus } from "@azure/msal-browser";
import { useRef, useState, useEffect } from "react";
import { AUTH_ENABLED, API_SCOPES } from "@lib/auth";

// ============================================================
// CONFIGURABLE SPLASH CONTENT
// Update this object to match your deployment's branding and
// mission statement. All fields are optional except `title`.
// ============================================================
const SPLASH_CONFIG = {
  eyebrow: "Supply Chain Assurance",
  title: "SCAI",
  subtitle: "Security Portal",
  mission: "This is a U.S. Government information system for authorized use only.",
  accessNotice: [
    "Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris.",
    "Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit.",
    "Sed ut perspiciatis unde omnis iste natus error sit voluptatem accusantium doloremque laudantium, totam rem aperiam eaque ipsa quae ab illo inventore veritatis et quasi architecto beatae vitae.",
    "Nemo enim ipsam voluptatem quia voluptas sit aspernatur aut odit aut fugit, sed quia consequuntur magni dolores eos qui ratione voluptatem sequi nesciunt neque porro quisquam.",
    "At vero eos et accusamus et iusto odio dignissimos ducimus qui blanditiis praesentium voluptatum deleniti atque corrupti quos dolores et quas molestias excepturi sint occaecati cupiditate.",
    "Nam libero tempore cum soluta nobis est eligendi optio cumque nihil impedit quo minus id quod maxime placeat facere possimus, omnis voluptas assumenda est, omnis dolor repellendus.",
  ],
  confirmLabel: "Acknowledge & Sign In",
};
// ============================================================

const STYLES = `
  @keyframes fadeUp {
    from { opacity: 0; transform: translateY(16px); }
    to   { opacity: 1; transform: translateY(0); }
  }
  @keyframes shield-pulse {
    0%, 100% { filter: drop-shadow(0 0 6px rgba(37,99,235,0.5)); }
    50%       { filter: drop-shadow(0 0 18px rgba(37,99,235,0.9)); }
  }
  @keyframes fadeIn {
    from { opacity: 0; }
    to   { opacity: 1; }
  }
  @keyframes pulse-dot {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.2; }
  }
  @keyframes bracket-in-left {
    from { opacity: 0; transform: translateX(-12px); }
    to   { opacity: 1; transform: translateX(0); }
  }
  @keyframes bracket-in-right {
    from { opacity: 0; transform: translateX(12px); }
    to   { opacity: 1; transform: translateX(0); }
  }
  @keyframes grid-fade {
    from { opacity: 0; }
    to   { opacity: 0.04; }
  }
  @keyframes btn-glow {
    0%, 100% { box-shadow: 0 0 10px rgba(37,99,235,0.3); }
    50%       { box-shadow: 0 0 22px rgba(37,99,235,0.55); }
  }
  .splash-grid {
    position: absolute; inset: 0;
    background-image:
      linear-gradient(rgba(37,99,235,0.8) 1px, transparent 1px),
      linear-gradient(90deg, rgba(37,99,235,0.8) 1px, transparent 1px);
    background-size: 48px 48px;
    animation: grid-fade 1.2s ease forwards;
    pointer-events: none;
  }
  .splash-bracket-l { animation: bracket-in-left  0.2s cubic-bezier(.16,1,.3,1) 0s both; }
  .splash-bracket-r { animation: bracket-in-right 0.2s cubic-bezier(.16,1,.3,1) 0s both; }
  .splash-eyebrow  { animation: fadeIn 0.2s ease 0.3s both; }
  .splash-title    { animation: fadeUp 0.3s cubic-bezier(.16,1,.3,1) 0s both; }
  .splash-subtitle { animation: fadeUp 0.3s cubic-bezier(.16,1,.3,1) 0.15s both; }
  .splash-divider  { animation: fadeIn 0.2s ease 0.3s both; }
  .splash-mission  { animation: fadeUp 0.2s cubic-bezier(.16,1,.3,1) 0.45s both; }
  .splash-notice   { animation: fadeUp 0.2s cubic-bezier(.16,1,.3,1) 0.6s both; }
  .splash-btn      { animation: fadeUp 0.2s cubic-bezier(.16,1,.3,1) 0.75s both; }
  .splash-footer   { animation: fadeIn 0.5s ease 1.4s both; }
  .splash-dot      { animation: pulse-dot 1.2s ease-in-out infinite; }
  .splash-cta:hover  { background: rgba(37,99,235,0.18) !important; border-color: #60a5fa !important; color: #bfdbfe !important; }
  .splash-cta:active { transform: scale(0.98); }
  .splash-cta-pulsing { animation: btn-glow 2.2s ease-in-out infinite; }
  .splash-scroll::-webkit-scrollbar { width: 4px; }
  .splash-scroll::-webkit-scrollbar-track { background: transparent; }
  .splash-scroll::-webkit-scrollbar-thumb { background: transparent; border-radius: 2px; }
  .splash-scroll:hover::-webkit-scrollbar-thumb { background: rgba(37,99,235,0.35); }
`;

// slate-950 matches the app's dark background
const splashBase: React.CSSProperties = {
  height: "100svh",
  background: "#020617",  // slate-950
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  fontFamily: "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  overflow: "hidden",
  position: "relative",
};

// Shown while redirect is in-flight (after clicking sign in)
const LoadingScreen = () => (
  <div style={splashBase}>
    <style>{STYLES}</style>
    <div className="splash-grid" />
    <div style={{ position: "absolute", inset: 0, background: "radial-gradient(ellipse 70% 60% at 50% 50%, transparent 30%, #020617 100%)", pointerEvents: "none" }} />
    <div style={{ position: "relative", display: "flex", alignItems: "center", gap: "24px" }}>
      <div className="splash-bracket-l" style={{ color: "#2563eb", opacity: 0.7 }}>
        <svg width="20" height="64" viewBox="0 0 20 64" fill="none"><path d="M18 2 L4 2 L4 62 L18 62" stroke="currentColor" strokeWidth="1.5" strokeLinecap="square"/></svg>
      </div>
      <div style={{ textAlign: "center", minWidth: "260px" }}>
        <div className="splash-eyebrow" style={{ fontSize: "10px", letterSpacing: "0.28em", color: "#2563eb", fontWeight: 600, textTransform: "uppercase", marginBottom: "16px" }}>
          {SPLASH_CONFIG.eyebrow}
        </div>
        <div className="splash-title" style={{ fontSize: "48px", fontWeight: 700, color: "#f1f5f9", lineHeight: 1 }}>
          {SPLASH_CONFIG.title}
        </div>
        <div className="splash-divider" style={{ margin: "20px auto", width: "40px", height: "1px", background: "linear-gradient(90deg, transparent, #2563eb, transparent)" }} />
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "8px", fontSize: "11px", color: "#475569", letterSpacing: "0.12em" }}>
          <span className="splash-dot" style={{ width: "6px", height: "6px", borderRadius: "50%", background: "#2563eb", display: "inline-block" }} />
          ESTABLISHING SESSION
        </div>
      </div>
      <div className="splash-bracket-r" style={{ color: "#2563eb", opacity: 0.7 }}>
        <svg width="20" height="64" viewBox="0 0 20 64" fill="none"><path d="M2 2 L16 2 L16 62 L2 62" stroke="currentColor" strokeWidth="1.5" strokeLinecap="square"/></svg>
      </div>
    </div>
  </div>
);

// Landing splash — shown before the user clicks sign in
const LandingSplash = ({ onSignIn }: { onSignIn: () => void }) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [showScrollHint, setShowScrollHint] = useState(false);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const check = () => setShowScrollHint(el.scrollHeight > el.clientHeight && el.scrollTop + el.clientHeight < el.scrollHeight - 4);
    check();
    el.addEventListener("scroll", check);
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => { el.removeEventListener("scroll", check); ro.disconnect(); };
  }, []);

  return (
  <div style={splashBase}>
    <style>{STYLES}</style>
    <div className="splash-grid" />
    <div style={{ position: "absolute", inset: 0, background: "radial-gradient(ellipse 80% 70% at 50% 50%, transparent 20%, #020617 100%)", pointerEvents: "none" }} />

    {/* Card — stretches to fill the full viewport height */}
    <div style={{ position: "relative", display: "flex", alignItems: "stretch", gap: "24px", width: "100%", maxWidth: "680px", height: "100svh", padding: "48px 40px" }}>
      {/* Left bracket — uses a percentage-height SVG that auto-sizes to content */}
      <div className="splash-bracket-l" style={{ color: "#2563eb", opacity: 0.55, flexShrink: 0, minHeight: "100%" }}>
        <svg width="18" viewBox="0 0 18 300" fill="none" style={{ height: "100%", minHeight: "260px" }} preserveAspectRatio="none">
          <path d="M16 4 L4 4 L4 296 L16 296" stroke="currentColor" strokeWidth="1.5" strokeLinecap="square" vectorEffect="non-scaling-stroke"/>
        </svg>
      </div>

      {/* Main content */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
        {/* Eyebrow */}
        <div className="splash-eyebrow" style={{ fontSize: "11px", letterSpacing: "0.3em", color: "#2563eb", fontWeight: 600, textTransform: "uppercase", marginBottom: "20px" }}>
          {SPLASH_CONFIG.eyebrow}
        </div>

        {/* Wordmark */}
        <div className="splash-title" style={{ lineHeight: 1 }}>
          <span style={{ fontSize: "96px", fontWeight: 700, letterSpacing: "-0.03em", color: "#f1f5f9" }}>
            {SPLASH_CONFIG.title}
          </span>
        </div>
        <div className="splash-subtitle" style={{ fontSize: "13px", color: "#475569", letterSpacing: "0.25em", textTransform: "uppercase", marginTop: "12px" }}>
          {SPLASH_CONFIG.subtitle}
        </div>

        {/* Divider */}
        <div className="splash-divider" style={{ margin: "28px 0", width: "48px", height: "1px", background: "linear-gradient(90deg, #2563eb, transparent)" }} />

        {/* Mission statement */}
        <div className="splash-mission" style={{ fontSize: "15px", color: "#94a3b8", lineHeight: 1.65, marginBottom: "24px" }}>
          {SPLASH_CONFIG.mission}
        </div>

        {/* Access notice box */}
        <div className="splash-notice" style={{
          border: "1px solid rgba(37,99,235,0.2)",
          borderLeft: "2px solid rgba(37,99,235,0.6)",
          borderRadius: "4px",
          marginBottom: "28px",
          background: "rgba(37,99,235,0.05)",
          flex: 1,
          display: "flex",
          flexDirection: "column",
          minHeight: 0,
        }}>
          <div style={{ fontSize: "10px", letterSpacing: "0.22em", color: "#2563eb", textTransform: "uppercase", fontWeight: 600, padding: "16px 20px 12px" }}>
            Acceptable Use Policy
          </div>
          <div ref={scrollRef} className="splash-scroll" tabIndex={0} role="region" aria-label="Acceptable Use Policy" style={{ flex: 1, overflowY: "auto", padding: "0 20px 16px", scrollbarWidth: "thin", scrollbarColor: "rgba(37,99,235,0.3) transparent" }}>
            {SPLASH_CONFIG.accessNotice.map((line, i) => (
              <div key={i} style={{ fontSize: "13px", color: "#94a3b8", lineHeight: 1.65, display: "flex", gap: "10px", marginBottom: i < SPLASH_CONFIG.accessNotice.length - 1 ? "8px" : 0 }}>
                <span style={{ color: "#475569", flexShrink: 0 }}>–</span>
                <span>{line}</span>
              </div>
            ))}
          </div>
          {showScrollHint && (
            <div style={{ position: "relative", height: 0, pointerEvents: "none" }}>
              <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: "40px", background: "linear-gradient(to bottom, transparent, rgba(2,6,23,0.85))", borderRadius: "0 0 4px 4px" }} />
              <div style={{ position: "absolute", bottom: "6px", left: "50%", transform: "translateX(-50%)", color: "#475569", lineHeight: 1 }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
              </div>
            </div>
          )}
        </div>

        {/* CTA button */}
        <div className="splash-btn">
          <button
            type="button"
            onClick={onSignIn}
            className="splash-cta splash-cta-pulsing"
            style={{
              width: "100%",
              padding: "16px 24px",
              background: "rgba(37,99,235,0.1)",
              border: "1px solid rgba(37,99,235,0.45)",
              borderRadius: "4px",
              color: "#93c5fd",
              fontSize: "13px",
              fontFamily: "inherit",
              fontWeight: 600,
              letterSpacing: "0.15em",
              textTransform: "uppercase",
              cursor: "pointer",
              transition: "all 0.2s ease",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "10px",
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
              <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
            </svg>
            {SPLASH_CONFIG.confirmLabel}
          </button>
        </div>
      </div>

      {/* Right bracket */}
      <div className="splash-bracket-r" style={{ color: "#2563eb", opacity: 0.55, flexShrink: 0, minHeight: "100%" }}>
        <svg width="18" viewBox="0 0 18 300" fill="none" style={{ height: "100%", minHeight: "260px" }} preserveAspectRatio="none">
          <path d="M2 4 L14 4 L14 296 L2 296" stroke="currentColor" strokeWidth="1.5" strokeLinecap="square" vectorEffect="non-scaling-stroke"/>
        </svg>
      </div>
    </div>

  </div>
  );
};

// Inner guard — only rendered when MsalProvider is in the tree (AUTH_ENABLED = true).
const AuthGuardInner = ({ children }: { children: React.ReactNode }) => {
  const isAuthenticated = useIsAuthenticated();
  const { instance, inProgress } = useMsal();

  const handleSignIn = () => {
    void instance.loginRedirect({ scopes: API_SCOPES });
  };

  // Redirect is in-flight — show loading screen
  if (inProgress !== InteractionStatus.None) {
    return <LoadingScreen />;
  }

  // Not authenticated, no interaction in progress — show landing splash with button
  if (!isAuthenticated) {
    return <LandingSplash onSignIn={handleSignIn} />;
  }

  return <>{children}</>;
};

/**
 * Route-level auth gate. When AUTH_ENABLED = false (local dev) the guard is a
 * transparent pass-through so no MSAL context is required.
 */
export const AuthGuard = ({ children }: { children: React.ReactNode }) => {
  if (!AUTH_ENABLED) return <>{children}</>;
  return <AuthGuardInner>{children}</AuthGuardInner>;
};
