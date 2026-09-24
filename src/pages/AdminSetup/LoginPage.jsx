import { useEffect, useState } from "react";
import { supabase } from "../../services/supabase";

const TRADE_BUSINESS_TYPES = ["Off Licence", "Restaurant"];

const emptyTradeApplicationForm = {
  business_name: "",
  contact_name: "",
  phone: "",
  email: "",
  shop_address: "",
  postcode: "",
  country: "Wales",
  business_type: TRADE_BUSINESS_TYPES[0],
  vat_number: "",
  company_number: "",
  notes: "",
};

export default function LoginPage({ onLogin }) {
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [submittingLogin, setSubmittingLogin] = useState(false);
  const [showTradeApplication, setShowTradeApplication] = useState(false);
  const [tradeApplicationForm, setTradeApplicationForm] = useState(
    emptyTradeApplicationForm
  );
  const [submittingTradeApplication, setSubmittingTradeApplication] =
    useState(false);
  const [isPasswordRecovery, setIsPasswordRecovery] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [updatingPassword, setUpdatingPassword] = useState(false);
  const [sendingReset, setSendingReset] = useState(false);

  useEffect(() => {
    const recoveryInUrl =
      window.location.hash.includes("type=recovery") ||
      new URLSearchParams(window.location.search).get("type") === "recovery";

    if (recoveryInUrl) {
      setIsPasswordRecovery(true);
    }

    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") {
        setIsPasswordRecovery(true);
      }
    });

    return () => data.subscription.unsubscribe();
  }, []);

    const submitLogin = async () => {
  const username = login.trim().toLowerCase();
  const cleanPassword = password;

  if (!username || !cleanPassword) {
    alert("Username and password are required");
    return;
  }

  setSubmittingLogin(true);

  try {
    const { data, error } = await supabase.rpc("fc_login_v2", {
      p_username: username,
      p_password: cleanPassword,
    });

    if (error) {
      console.error("FC login error:", error);
      alert(error.message || "Invalid username or password");
      return;
    }

    if (data?.ok === false) {
      alert(data?.error || "Invalid username or password");
      return;
    }

    const profile = data?.profile;
    const sessionToken = data?.session_token;

    if (!profile || !sessionToken) {
      throw new Error("FC Security did not return a valid login session.");
    }

    const loggedInUser = {
      ...profile,
      fc_session_token: sessionToken,
      fc_session_expires_at: data?.expires_at || null,
      fc_session_idle_expires_at: data?.idle_expires_at || null,
    };

    const { error: auditError } = await supabase
      .from("audit_logs")
      .insert({
        user_id: loggedInUser.id,
        username: loggedInUser.username,
        staff_name: loggedInUser.staff_name,
        role_access_level: loggedInUser.access_level,
        action_type: "Login",
        page_module: "FC Security",
        order_id: null,
        product_id: null,
        old_value: null,
        new_value: JSON.stringify({
          staff_code: loggedInUser.staff_code || null,
          login_code: loggedInUser.login_code || null,
        }),
        created_at: new Date().toISOString(),
      });

    if (auditError) {
      console.warn("Could not write login audit:", auditError);
    }

    localStorage.setItem("fairchoice_user", JSON.stringify(loggedInUser));
    localStorage.setItem("loggedInUser", JSON.stringify(loggedInUser));
    localStorage.setItem("loginPortal", "staff");

    setPassword("");
    onLogin(loggedInUser);
  } catch (error) {
    console.error("Unexpected FC login error:", error);
    alert(`Login failed: ${error.message}`);
  } finally {
    setSubmittingLogin(false);
  }
};


  const resetPassword = async () => {
    setSendingReset(true);
    try {
      alert("FC logins use username and password. Contact an administrator to reset this login password.");
    } finally {
      setSendingReset(false);
    }
  };

  const updatePassword = async () => {
    if (newPassword.length < 8) {
      alert("Password must be at least 8 characters long.");
      return;
    }

    if (newPassword !== confirmPassword) {
      alert("The passwords do not match.");
      return;
    }

    setUpdatingPassword(true);
    try {
      const { error } = await supabase.auth.updateUser({
        password: newPassword,
      });

      if (error) {
        alert(`Could not update password: ${error.message}`);
        return;
      }

      await supabase.auth.signOut();
      window.history.replaceState({}, document.title, window.location.pathname);
      setIsPasswordRecovery(false);
      setNewPassword("");
      setConfirmPassword("");
      alert("Password updated successfully. Please sign in with your new password.");
    } finally {
      setUpdatingPassword(false);
    }
  };

  const updateTradeApplicationField = (field, value) => {
    setTradeApplicationForm((prev) => ({ ...prev, [field]: value }));
  };

  const submitTradeApplication = async (event) => {
    event.preventDefault();

    const requiredFields = [
      ["business_name", "Business Name"],
      ["contact_name", "Contact Name"],
      ["phone", "Phone Number"],
      ["email", "Email"],
      ["shop_address", "Shop Address"],
      ["postcode", "Postcode"],
      ["country", "Country"],
      ["business_type", "Business Type"],
    ];

    const missingField = requiredFields.find(
      ([field]) => !String(tradeApplicationForm[field] || "").trim()
    );

    if (missingField) {
      alert(`${missingField[1]} is required.`);
      return;
    }

    setSubmittingTradeApplication(true);

    const { error } = await supabase.from("trade_account_applications").insert({
      business_name: tradeApplicationForm.business_name.trim(),
      contact_name: tradeApplicationForm.contact_name.trim(),
      phone: tradeApplicationForm.phone.trim(),
      email: tradeApplicationForm.email.trim().toLowerCase(),
      shop_address: tradeApplicationForm.shop_address.trim(),
      postcode: tradeApplicationForm.postcode.trim(),
      country: tradeApplicationForm.country,
      business_type: tradeApplicationForm.business_type.trim(),
      vat_number: tradeApplicationForm.vat_number.trim(),
      company_number: tradeApplicationForm.company_number.trim(),
      notes: tradeApplicationForm.notes.trim(),
      status: "Pending",
    });

    setSubmittingTradeApplication(false);

    if (error) {
      alert(
        `Could not submit trade account application.\n\n${error.message}\n\nIf the table is missing, run supabase/trade_account_applications.sql in Supabase.`
      );
      return;
    }

    setTradeApplicationForm(emptyTradeApplicationForm);
    setShowTradeApplication(false);
    alert(
      "Thank you. Your trade account application has been submitted. FairChoice will review and contact you."
    );
  };

  if (isPasswordRecovery) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-100 p-4">
        <div className="bg-white p-6 rounded-2xl shadow w-full max-w-md">
          <h1 className="text-2xl font-bold mb-2">Create New Password</h1>
          <p className="mb-5 text-sm text-slate-600">
            Enter your new FairChoice portal password.
          </p>

          <input
            className="input-box mb-3"
            type="password"
            placeholder="New password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
          />

          <input
            className="input-box mb-4"
            type="password"
            placeholder="Confirm new password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && updatePassword()}
          />

          <button
            type="button"
            onClick={updatePassword}
            disabled={updatingPassword}
            className="w-full bg-blue-600 text-white py-3 rounded-xl font-bold disabled:bg-slate-300"
          >
            {updatingPassword ? "Updating password..." : "Update Password"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-100 p-4">
      <div className="bg-white p-6 rounded-2xl shadow w-full max-w-3xl">
        <h1 className="text-2xl font-bold mb-4">FairChoice Login</h1>

        <div className={showTradeApplication ? "grid gap-6 md:grid-cols-[320px_1fr]" : ""}>
          <div>
            <input
              className="input-box mb-3"
              placeholder="Username or email"
              value={login}
              onChange={(e) => setLogin(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submitLogin()}
            />

            <input
              className="input-box mb-4"
              type="password"
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submitLogin()}
            />

            <button
              onClick={submitLogin}
              disabled={submittingLogin}
              className="w-full bg-blue-600 text-white py-3 rounded-xl font-bold disabled:bg-slate-300"
            >
              {submittingLogin ? "Signing in..." : "Login"}
            </button>

            <button
              type="button"
              onClick={resetPassword}
              disabled={sendingReset}
              className="w-full mt-3 text-sm font-bold text-blue-700 disabled:text-slate-400"
            >
              {sendingReset ? "Opening help..." : "Password Help"}
            </button>

            <button
              type="button"
              onClick={() => setShowTradeApplication((value) => !value)}
              className="mt-5 w-full rounded-xl border border-orange-500 bg-white px-4 py-3 text-sm font-bold text-blue-900 hover:bg-orange-50"
            >
              {showTradeApplication ? "Hide Trade Account Registration" : "Register for Trade Account"}
            </button>
          </div>

          {showTradeApplication && (
            <form onSubmit={submitTradeApplication} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <h2 className="mb-3 text-lg font-bold">Trade Account Application</h2>
              <div className="grid gap-3 md:grid-cols-2">
                <input className="input-box" placeholder="Business Name" value={tradeApplicationForm.business_name} onChange={(e) => updateTradeApplicationField("business_name", e.target.value)} />
                <input className="input-box" placeholder="Contact Name" value={tradeApplicationForm.contact_name} onChange={(e) => updateTradeApplicationField("contact_name", e.target.value)} />
                <input className="input-box" placeholder="Phone Number" value={tradeApplicationForm.phone} onChange={(e) => updateTradeApplicationField("phone", e.target.value)} />
                <input className="input-box" type="email" placeholder="Email" value={tradeApplicationForm.email} onChange={(e) => updateTradeApplicationField("email", e.target.value)} />
                <input className="input-box md:col-span-2" placeholder="Shop Address" value={tradeApplicationForm.shop_address} onChange={(e) => updateTradeApplicationField("shop_address", e.target.value)} />
                <input className="input-box" placeholder="Postcode" value={tradeApplicationForm.postcode} onChange={(e) => updateTradeApplicationField("postcode", e.target.value)} />
                <select className="input-box" value={tradeApplicationForm.country} onChange={(e) => updateTradeApplicationField("country", e.target.value)}>
                  <option value="England">England</option>
                  <option value="Wales">Wales</option>
                </select>
                <select className="input-box" value={tradeApplicationForm.business_type} onChange={(e) => updateTradeApplicationField("business_type", e.target.value)}>
                  {TRADE_BUSINESS_TYPES.map((businessType) => <option key={businessType} value={businessType}>{businessType}</option>)}
                </select>
                <input className="input-box" placeholder="VAT Number (optional)" value={tradeApplicationForm.vat_number} onChange={(e) => updateTradeApplicationField("vat_number", e.target.value)} />
                <input className="input-box" placeholder="Company Number (optional)" value={tradeApplicationForm.company_number} onChange={(e) => updateTradeApplicationField("company_number", e.target.value)} />
                <textarea className="input-box min-h-[90px] md:col-span-2" placeholder="Message / Notes" value={tradeApplicationForm.notes} onChange={(e) => updateTradeApplicationField("notes", e.target.value)} />
              </div>
              <button type="submit" disabled={submittingTradeApplication} className="mt-4 w-full rounded-xl bg-orange-600 px-4 py-3 text-sm font-bold text-white disabled:bg-slate-300">
                {submittingTradeApplication ? "Submitting..." : "Submit Application"}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
