import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useAdminContacts } from "@/api/meta";
import { startSso } from "@/auth-session";
import { BrandMark } from "@/components/layout/BrandMark";
import { LoginParticles } from "./LoginParticles";

// SPEC-platform-09. The page has its own light/dark palette (hex on purpose, taken from the app's paper and logo
// tokens): it shows before any app theme exists and its toggle must not change the theme the app uses after sign-in (FR-6).

const logoSrc = `${import.meta.env.BASE_URL}zslogo.svg`;

/** The sign-in page: hero on the left, one SSO button on the right. */
export function LoginPage() {
  const [params] = useSearchParams();
  const [mode, setMode] = useState<"dark" | "light">("light");
  const [pressed, setPressed] = useState(false);
  const contacts = useAdminContacts();
  const isDark = mode === "dark";

  const error = params.get("error");
  const errorMessage = error ? params.get("error_description") || `Authentication failed: ${error}` : null;

  const signIn = () => {
    setPressed(true);
    startSso();
  };

  const muted = isDark ? "#8c887f" : "#85817a";
  const faint = isDark ? "#6b675f" : "#a29e95";
  const accent = isDark ? "#8fb0ff" : "#3d42e8";
  const hairline = isDark ? "rgba(255,255,255,0.08)" : "rgba(26,26,25,0.08)";

  return (
    <div className="relative flex min-h-svh w-full overflow-hidden font-sans transition-colors duration-[400ms]" style={{ background: isDark ? "#121211" : "#f5f3ee", color: isDark ? "#ecebe6" : "#1a1a19" }}>
      <button
        type="button"
        aria-label={isDark ? "Switch to light theme" : "Switch to dark theme"}
        onClick={() => setMode(isDark ? "light" : "dark")}
        className="absolute right-4 top-4 z-10 flex h-9 w-9 items-center justify-center rounded-[10px] transition-all duration-300 sm:right-[18px] sm:top-[18px]"
        style={{ border: `1px solid ${hairline}`, color: faint, background: "transparent" }}
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          {isDark ? (
            <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
          ) : (
            <>
              <circle cx="12" cy="12" r="5" />
              <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
            </>
          )}
        </svg>
      </button>

      <div className="relative flex min-w-0 flex-1 flex-col justify-center overflow-hidden px-8 py-16 max-[960px]:w-full max-[960px]:flex-auto max-[640px]:pt-[4.5rem] sm:px-12 lg:px-20">
        <div className="pointer-events-none absolute rounded-full transition-colors duration-[400ms]" style={{ width: 500, height: 500, top: -150, left: -120, background: isDark ? "rgba(47,168,255,0.08)" : "rgba(47,168,255,0.10)", filter: "blur(120px)" }} />
        <div className="pointer-events-none absolute rounded-full transition-colors duration-[400ms]" style={{ width: 350, height: 350, bottom: -80, right: "25%", background: isDark ? "rgba(90,45,216,0.10)" : "rgba(90,45,216,0.07)", filter: "blur(100px)" }} />
        <LoginParticles isDark={isDark} />
        <div className="relative z-[2] max-w-[560px] max-[960px]:max-w-none">
          <div className="mb-5 flex items-center gap-2.5">
            <BrandMark size={28} />
            <span className="text-[11px] font-bold uppercase tracking-[0.14em]" style={{ color: accent }}>NerveCenter</span>
          </div>
          <h1 className="mb-4 text-[clamp(2.2rem,4.5vw,3.5rem)] font-extrabold leading-[1.1] tracking-[-0.02em]">
            The{" "}
            <span style={{ background: "linear-gradient(135deg,#2fa8ff 0%,#3d42e8 55%,#5a2dd8 100%)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text" }}>operations harness</span>{" "}
            for data teams.
          </h1>
          <p className="max-w-[460px] text-[15px] leading-relaxed" style={{ color: isDark ? "#a8a49b" : "#5f5b53" }}>
            Tickets, pipelines and data quality in one place, with Sonic investigating and fixing what breaks.
          </p>
        </div>
      </div>

      <div className="self-stretch max-[960px]:h-px max-[960px]:w-full lg:w-px" style={{ background: isDark ? "rgba(255,255,255,0.06)" : "rgba(26,26,25,0.08)" }} />

      <div
        className="relative z-[2] flex w-full items-center justify-center px-6 pb-6 pt-0 max-[960px]:flex-auto sm:px-10 lg:w-[min(500px,100%)] lg:flex-none lg:px-6 lg:py-10"
        style={{ background: isDark ? "rgba(255,255,255,0.02)" : "rgba(255,255,255,0.35)", backdropFilter: "blur(40px)", WebkitBackdropFilter: "blur(40px)" }}
      >
        <div
          className="login-card relative w-full max-w-[400px] overflow-hidden rounded-[20px] px-6 py-8 sm:px-8 sm:py-10 max-[640px]:max-w-none"
          style={{ background: isDark ? "rgba(30,30,28,0.8)" : "rgba(255,255,255,0.85)", border: `1px solid ${hairline}`, boxShadow: isDark ? "none" : "0 8px 40px rgba(26,26,25,0.06)", backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)" }}
        >
          <div className="mb-7 flex items-center justify-center gap-2.5">
            <img src={logoSrc} alt="ZS" className="block h-10 w-10 object-contain" draggable={false} />
            <div className="h-[18px] w-px" style={{ background: isDark ? "rgba(255,255,255,0.1)" : "rgba(26,26,25,0.1)" }} />
            <span className="text-xs font-semibold tracking-[0.02em]" style={{ color: muted }}>NerveCenter</span>
          </div>

          <h2 className="mb-1 text-center text-xl font-bold">Welcome back</h2>
          <p className="mb-6 text-center text-[12.5px] leading-normal" style={{ color: muted }}>Sign in with the organization SSO</p>

          {errorMessage && (
            <div role="alert" className="mb-4 rounded-lg px-4 py-3 text-sm" style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", color: "#EF4444" }}>
              {errorMessage}
            </div>
          )}

          <button
            type="button"
            onClick={signIn}
            disabled={pressed}
            className="btn-sso relative flex h-[46px] w-full cursor-pointer items-center justify-center gap-2 overflow-hidden rounded-xl border-none text-[13.5px] font-semibold text-white transition-all duration-[250ms] hover:-translate-y-0.5 hover:shadow-[0_8px_28px_rgba(61,66,232,0.35)] active:scale-[0.985] disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:translate-y-0 disabled:hover:shadow-none"
            style={{ background: "linear-gradient(135deg,#2563eb,#5a2dd8)", fontFamily: "inherit" }}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <rect x="3" y="11" width="18" height="11" rx="2" />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
            {pressed ? "Signing in..." : "Sign in with SSO"}
          </button>

          <div className="mt-5 text-center text-xs" style={{ color: faint }}>
            Need access?{" "}
            {contacts.length ? (
              <a href={`mailto:${contacts.join(",")}`} className="font-semibold transition-opacity duration-200 hover:opacity-80" style={{ color: accent }}>Contact your administrator</a>
            ) : (
              <span className="font-semibold" style={{ color: accent }}>Contact your administrator</span>
            )}
          </div>
        </div>
      </div>

      {/* The card's border glow turns; reduced motion stops it. */}
      <style>{`
        @property --ca { syntax: '<angle>'; initial-value: 0deg; inherits: false; }
        @keyframes login-rb { to { --ca: 360deg; } }
        .login-card::before { content: ''; position: absolute; inset: 0; border-radius: inherit; padding: 1px;
          background: conic-gradient(from var(--ca, 0deg), transparent 30%, rgba(61,66,232,0.35) 50%, transparent 70%);
          -webkit-mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0); mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
          -webkit-mask-composite: xor; mask-composite: exclude; opacity: 0.5; pointer-events: none; animation: login-rb 6s linear infinite; }
        @media (prefers-reduced-motion: reduce) { .login-card::before { animation: none; } }
        .btn-sso::before { content: ''; position: absolute; inset: 0; background: linear-gradient(135deg, rgba(255,255,255,0.15), transparent); opacity: 0; transition: opacity 0.25s; }
        .btn-sso:hover::before { opacity: 1; }
      `}</style>
    </div>
  );
}
