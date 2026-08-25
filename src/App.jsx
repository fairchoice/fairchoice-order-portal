import { useEffect, useState } from "react";
import CustomerOrder from "./pages/CustomerOrder";
import LoginPage from "./pages/AdminSetup/LoginPage";

import PriceManagement from "./pages/AdminSetup/PriceManagement";
import PricingRule from "./pages/AdminSetup/PricingRule";
import { canAccessPage, isMasterAdmin, normalizeRole } from "./security/accessControlRegistry";
import {
  clearFcSessionStorage,
  mergeAuthenticatedProfile,
} from "./services/fcSession";

const SESSION_KEY = "fairchoice_user";
const LAST_ACTIVE_KEY = "fairchoice_last_active";
const SESSION_TIMEOUT = 10 * 60 * 1000; // Customer portal timeout only
const DUTY_KEY = "fairchoice_staff_duty";

function clearLegacyProfileStorage() {
  clearFcSessionStorage(localStorage);
}

function storeCompatibleProfile(profile) {
  localStorage.setItem(SESSION_KEY, JSON.stringify(profile));
  localStorage.setItem("loggedInUser", JSON.stringify(profile));
  localStorage.setItem("loginPortal", "staff");
  localStorage.setItem(LAST_ACTIVE_KEY, Date.now().toString());
}

const isCustomerProfile = (profile) => normalizeRole(profile?.role || profile?.access_level) === "Customer";

function loadCompatibleProfile() {
  try {
    const savedProfile = JSON.parse(
      localStorage.getItem(SESSION_KEY) || localStorage.getItem("loggedInUser") || "null"
    );
    const lastActive = Number(localStorage.getItem(LAST_ACTIVE_KEY) || 0);

    if (!savedProfile) return null;
    if (isCustomerProfile(savedProfile) && (!lastActive || Date.now() - lastActive > SESSION_TIMEOUT)) {
      return null;
    }

    return savedProfile;
  } catch {
    return null;
  }
}

export default function App() {
  const [profile, setProfile] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [activeDuty, setActiveDuty] = useState(() => localStorage.getItem(DUTY_KEY) || "");

  useEffect(() => {
    const compatibleProfile = loadCompatibleProfile();
    setProfile(compatibleProfile);
    setAuthLoading(false);
  }, []);

  const handleLogin = (userProfile) => {
    setProfile((currentProfile) => {
      const mergedProfile = mergeAuthenticatedProfile(
        currentProfile,
        userProfile,
      );
      storeCompatibleProfile(mergedProfile);
      return mergedProfile;
    });
  };

  const handleLogout = () => {
    clearLegacyProfileStorage();
    localStorage.removeItem(DUTY_KEY);
    setActiveDuty("");
    setProfile(null);
  };

  useEffect(() => {
    if (!profile || !isCustomerProfile(profile)) return;

    const updateActivity = () => localStorage.setItem(LAST_ACTIVE_KEY, Date.now().toString());
    const checkTimeout = () => {
      const lastActive = Number(localStorage.getItem(LAST_ACTIVE_KEY) || 0);
      if (Date.now() - lastActive > SESSION_TIMEOUT) {
        clearLegacyProfileStorage();
        setProfile(null);
        alert("You have been logged out after 10 minutes of inactivity.");
      }
    };
    window.addEventListener("click", updateActivity);
    window.addEventListener("keydown", updateActivity);
    window.addEventListener("touchstart", updateActivity);
    const timer = setInterval(checkTimeout, 15000);
    return () => {
      window.removeEventListener("click", updateActivity);
      window.removeEventListener("keydown", updateActivity);
      window.removeEventListener("touchstart", updateActivity);
      clearInterval(timer);
    };
  }, [profile]);

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-100 p-4">
        <div className="text-sm font-bold text-slate-600">Loading...</div>
      </div>
    );
  }

  if (!profile) {
    return <LoginPage onLogin={handleLogin} />;
  }

  const normalizedRole = normalizeRole(profile.role || profile.access_level);
  const effectiveDuty = normalizedRole === "Brand Partner" ? "admin" : activeDuty;

  const selectDuty = (duty) => {
    localStorage.setItem(DUTY_KEY, duty);
    setActiveDuty(duty);
  };

  if (profile && !isCustomerProfile(profile) && !isMasterAdmin(profile) && !effectiveDuty) {
    const duties = [
      canAccessPage(profile, "page.order.sales_rep") && ["sales_rep", "Sales Rep", "Today’s route, orders and expenses"],
      canAccessPage(profile, "page.operations.warehouse") && ["warehouse", "Warehouse", "Warehouse operations only"],
      canAccessPage(profile, "page.operations.driver") && ["driver", "Driver", "Driver portal and expenses only"],
      ["Admin", "Super Admin"].includes(normalizedRole) && ["admin", "Admin", "Your permitted Back Office functions (Sales Rep and Driver excluded)"],
    ].filter(Boolean);
    return (
      <div className="min-h-screen bg-slate-100 p-4 flex items-center justify-center">
        <div className="w-full max-w-2xl bg-white rounded-3xl shadow-xl p-6">
          <h1 className="text-2xl font-bold">Choose today’s duty</h1>
          <p className="mt-1 text-sm text-slate-500">Select the job you are logging in to perform. This stays active until you manually log out.</p>
          <div className="grid sm:grid-cols-2 gap-3 mt-5">
            {duties.map(([key,label,help]) => <button key={key} onClick={() => selectDuty(key)} className="text-left border rounded-2xl p-4 hover:border-blue-700 hover:bg-blue-50"><strong className="block text-lg">{label}</strong><span className="text-sm text-slate-500">{help}</span></button>)}
          </div>
          {!duties.length && <p className="mt-4 text-red-700 font-bold">No permitted duty is available for this login.</p>}
          <button onClick={handleLogout} className="mt-5 text-sm font-bold text-slate-600">Log out</button>
        </div>
      </div>
    );
  }


  return (
    <CustomerOrder
      userProfile={profile}
      onLogout={handleLogout}
      onProfileRefresh={handleLogin}
      activeDuty={effectiveDuty}
    />
  );
}
