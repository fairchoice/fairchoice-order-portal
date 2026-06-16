import { useState } from "react";
import { supabase } from "../services/supabase";

export default function LoginPage({ onLogin }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

 const login = async () => {
  const cleanUsername = username.trim().toLowerCase();
  const cleanPassword = password.trim();

  const { data, error } = await supabase
    .from("login_users")
    .select("*")
    .ilike("username", cleanUsername)
    .eq("password", cleanPassword)
    .eq("active", true)
    .limit(1);

  console.log("LOGIN DATA:", data);
  console.log("LOGIN ERROR:", error);

  if (error || !data || data.length === 0) {
    alert("Invalid login credentials");
    return;
  }

  onLogin(data[0]);
};
  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-100 p-4">
      <div className="bg-white p-6 rounded-2xl shadow w-full max-w-sm">
        <h1 className="text-2xl font-bold mb-4">FairChoice Login</h1>

        <input
          className="input-box mb-3"
          placeholder="Username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
        />

        <input
          className="input-box mb-4"
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />

        <button
          onClick={login}
          className="w-full bg-blue-600 text-white py-3 rounded-xl font-bold"
        >
          Login
        </button>
      </div>
    </div>
  );
}