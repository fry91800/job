import { useEffect, useState } from "react";
import { api, errorText } from "../api";

const token = () => new URLSearchParams(window.location.search).get("token") ?? "";

// Opened from the confirmation email (A6).
export function VerifyEmailPage({ done }: { done: () => void }) {
  const [message, setMessage] = useState("Confirming…");
  useEffect(() => {
    api("POST", "/api/auth/email-verification/confirm", { token: token() }).then((result) => {
      setMessage(result.ok ? "Your email address is confirmed." : errorText(result));
    });
  }, []);
  return (
    <div>
      <h2>Email confirmation</h2>
      <p>{message}</p>
      <button onClick={done}>Continue</button>
    </div>
  );
}

// Opened from the password reset email (A4).
export function ResetPasswordPage({ done }: { done: () => void }) {
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  async function submit() {
    const result = await api("POST", "/api/auth/password-reset/confirm", { token: token(), password });
    if (result.ok) return done();
    setMessage(errorText(result));
  }
  return (
    <div>
      <h2>Choose a new password</h2>
      <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} /> <button onClick={submit}>Save and log in</button>
      {message && <p className="error">{message}</p>}
    </div>
  );
}
