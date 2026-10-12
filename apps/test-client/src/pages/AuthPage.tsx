import { useState } from "react";
import type { MeResponse } from "@job/shared";
import { api, errorText, type ApiResult } from "../api";

function useField(initial = "") {
  const [value, setValue] = useState(initial);
  return { value, onChange: (event: { target: { value: string } }) => setValue(event.target.value), set: setValue };
}

export function AuthPage({ me, refreshMe }: { me: MeResponse["user"]; refreshMe: () => void }) {
  const email = useField();
  const password = useField();
  const newPassword = useField();
  const [message, setMessage] = useState("");

  async function run(promise: Promise<ApiResult<unknown>>, success: string) {
    const result = await promise;
    setMessage(result.ok ? success : errorText(result));
    refreshMe();
  }

  const credentials = () => ({ email: email.value, password: password.value });

  return (
    <div>
      <h3>Current user</h3>
      <pre>{JSON.stringify(me, null, 2)}</pre>
      {message && <p className={message.match(/^\d{3} /) ? "error" : undefined}>{message}</p>}

      <fieldset>
        <legend>Sign up / log in</legend>
        <label>Email <input value={email.value} onChange={email.onChange} /></label>
        <label>Password <input type="password" value={password.value} onChange={password.onChange} /></label>
        <button onClick={() => run(api("POST", "/api/auth/signup", credentials()), "Signed up")}>Sign up</button>{" "}
        <button onClick={() => run(api("POST", "/api/auth/login", credentials()), "Logged in")}>Log in</button>
        <div>
          Seeded users:{" "}
          <button onClick={() => { email.set("demo@example.com"); password.set("demo-password"); }}>demo</button>{" "}
          <button onClick={() => { email.set("alice@example.com"); password.set("alice-password"); }}>alice</button>
        </div>
      </fieldset>

      <fieldset>
        <legend>Session</legend>
        <button onClick={() => run(api("POST", "/api/auth/logout"), "Logged out")}>Log out</button>{" "}
        <button onClick={() => run(api("POST", "/api/auth/logout-all"), "Logged out everywhere")}>Log out everywhere</button>
      </fieldset>

      <fieldset>
        <legend>Change password / delete account (uses the password field above as the current password)</legend>
        <label>New password <input type="password" value={newPassword.value} onChange={newPassword.onChange} /></label>
        <button onClick={() => run(api("POST", "/api/auth/password", { currentPassword: password.value, newPassword: newPassword.value }), "Password changed")}>
          Change password
        </button>{" "}
        <button onClick={() => confirm("Delete this account?") && run(api("DELETE", "/api/auth/account", { password: password.value }), "Account deleted")}>
          Delete account
        </button>
      </fieldset>
    </div>
  );
}
