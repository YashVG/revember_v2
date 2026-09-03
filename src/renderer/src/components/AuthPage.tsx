import { useState } from "react";
import { BookOpen, LoaderCircle, LogIn, UserPlus } from "lucide-react";
import type { AuthActionResult, AuthState } from "../../../../shared/types";
import { toErrorMessage } from "../utils";

type AuthPageProps = {
  state: AuthState;
  onState: (state: AuthState) => void;
};

export function AuthPage({ state, onState }: AuthPageProps) {
  const [mode, setMode] = useState<"sign-in" | "sign-up">("sign-in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmationMessage, setConfirmationMessage] = useState<string>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy || !state.configured) return;
    try {
      setBusy(true);
      setError(undefined);
      setConfirmationMessage(undefined);
      const result: AuthActionResult = mode === "sign-in"
        ? await window.revember.signIn(email, password)
        : await window.revember.signUp(email, password);
      onState(result.state);
      if (result.requiresEmailConfirmation) {
        setConfirmationMessage("Check your email to confirm your account, then return to Revember from the confirmation link.");
      }
    } catch (cause) {
      setError(toErrorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  return <main className="auth-page">
    <section className="auth-card" aria-labelledby="auth-title">
      <div className="auth-mark"><BookOpen /></div>
      <p className="eyebrow">Your private learning space</p>
      <h1 id="auth-title">{mode === "sign-in" ? "Welcome back" : "Create your account"}</h1>
      <p className="auth-description">Sign in to keep your knowledge vault private and available across your devices.</p>
      {state.configurationError ? <p className="auth-error">{state.configurationError}</p> : <form onSubmit={(event) => void submit(event)}>
        <label>
          <span>Email</span>
          <input autoComplete="email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" required />
        </label>
        <label>
          <span>Password</span>
          <input autoComplete={mode === "sign-in" ? "current-password" : "new-password"} type="password" value={password} onChange={(event) => setPassword(event.target.value)} minLength={8} placeholder="At least 8 characters" required />
        </label>
        <button className="primary auth-submit" type="submit" disabled={busy}>
          {busy ? <LoaderCircle className="spin" /> : mode === "sign-in" ? <LogIn /> : <UserPlus />}
          {busy ? "Working…" : mode === "sign-in" ? "Sign in" : "Create account"}
        </button>
      </form>}
      {confirmationMessage && <p className="auth-confirmation" role="status">{confirmationMessage}</p>}
      {error && <p className="auth-error" role="alert">{error}</p>}
      {!state.configurationError && <button className="text-button auth-mode" type="button" disabled={busy} onClick={() => {
        setMode((current) => current === "sign-in" ? "sign-up" : "sign-in");
        setError(undefined);
        setConfirmationMessage(undefined);
      }}>{mode === "sign-in" ? "Need an account? Create one" : "Already have an account? Sign in"}</button>}
    </section>
  </main>;
}
