import { useState } from "react";
import { supabase } from "../services/supabase";

export default function LoginPage({ onLogin }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  const login = async () => {
    const cleanUsername = username.trim().toLowerCase();
    const cleanPassword = password.trim();

    const { data: loginData, error: loginError } = await supabase
      .from("login_users")
      .select("*")
      .eq("username", cleanUsername)
      .eq("password", cleanPassword)
      .eq("active", true)
      .limit(1);

    if (loginError || !loginData || loginData.length === 0) {
      alert("Invalid username or password");
      return;
    }

    const loginUser = loginData[0];

    let linkedStaff = null;

 if (
  loginUser.role === "Sales Rep" ||
  loginUser.role === "Driver" ||
  loginUser.role === "Warehouse"
) {
  if (!loginUser.staff_id) {
    alert("Login blocked. This login is not linked to a staff record.");
    return;
  }

      const { data: staffData, error: staffError } = await supabase
        .from("staff_users")
        .select("id, staff_name, phone, email, active")
        .eq("id", loginUser.staff_id)
        .eq("active", true)
        .single();

      if (staffError || !staffData) {
        alert("Login blocked. Linked staff record is inactive or missing.");
        return;
      }

      linkedStaff = staffData;
    }

    const loggedInUser = {
      id: loginUser.id,
      username: loginUser.username,
      role: loginUser.role,
      staff_id: loginUser.staff_id || null,
      staff_name: linkedStaff?.staff_name || loginUser.username,
      active: loginUser.active,
      customer_account_id: loginUser.customer_account_id || null,
    };

    localStorage.setItem("loggedInUser", JSON.stringify(loggedInUser));
    console.log("LOGGED IN STAFF USER:", loggedInUser);

    onLogin(loggedInUser);
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