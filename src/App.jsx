import { lazy, Suspense, useEffect, useState } from "react";
import LoginPage from "./pages/AdminSetup/LoginPage";

const CustomerOrder = lazy(() => import("./pages/CustomerOrder"));
const SalesRepPromotionRun = lazy(() => import("./pages/SalesRepPromotionRun"));

import PriceManagement from "./pages/AdminSetup/PriceManagement";
import PricingRule from "./pages/AdminSetup/PricingRule";
import { canAccessPage, isMasterAdmin, normalizeRole } from "./security/accessControlRegistry";
import {
  clearFcSessionStorage,
  mergeAuthenticatedProfile,
} from "./services/fcSession";

const SESSION_KEY = "fairchoice_user";
const LAST_ACTIVE_KEY = "fairchoice_last_active";
const SESSION_TIMEOUT = 10 * 60 * 1000; // All authenticated FairChoice portals
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
    if (!lastActive || Date.now() - lastActive > SESSION_TIMEOUT) {
      clearLegacyProfileStorage();
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
  const [loginPageKey, setLoginPageKey] = useState(0);
  const [appRoute, setAppRoute] = useState(() => window.location.hash);

  useEffect(() => {
    const syncRoute = () => setAppRoute(window.location.hash);
    window.addEventListener("hashchange", syncRoute);
    return () => window.removeEventListener("hashchange", syncRoute);
  }, []);

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
    setLoginPageKey((value) => value + 1);
  };

  useEffect(() => {
    if (!profile) return undefined;

    const updateActivity = () => localStorage.setItem(LAST_ACTIVE_KEY, Date.now().toString());
    const checkTimeout = () => {
      const lastActive = Number(localStorage.getItem(LAST_ACTIVE_KEY) || 0);
      if (!lastActive || Date.now() - lastActive > SESSION_TIMEOUT) {
        // Automatic timeout clears authentication only. Keep DUTY_KEY so staff
        // re-authenticate and return to the same duty instead of choosing it again.
        clearLegacyProfileStorage();
        setProfile(null);
        setLoginPageKey((value) => value + 1);
      }
    };

    updateActivity();
    const activityEvents = ["pointerdown", "keydown", "touchstart", "scroll", "wheel"];
    activityEvents.forEach((eventName) =>
      window.addEventListener(eventName, updateActivity, { passive: true })
    );
    const timer = window.setInterval(checkTimeout, 15000);

    return () => {
      activityEvents.forEach((eventName) =>
        window.removeEventListener(eventName, updateActivity)
      );
      window.clearInterval(timer);
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
    return <LoginPage key={loginPageKey} onLogin={handleLogin} />;
  }

  const normalizedRole = normalizeRole(profile.role || profile.access_level);
  const effectiveDuty = normalizedRole === "Brand Partner" ? "admin" : activeDuty;

  const selectDuty = (duty) => {
    localStorage.setItem(DUTY_KEY, duty);
    setActiveDuty(duty);
    if (duty === "sales_rep") {
      window.history.replaceState(window.history.state, "", window.location.pathname + window.location.search);
      setAppRoute("");
    }
  };

  if (profile && !isCustomerProfile(profile) && !isMasterAdmin(profile) && !effectiveDuty) {
    const duties = [
      canAccessPage(profile, "page.order.sales_rep") && ["sales_rep", ["Admin", "Super Admin"].includes(normalizedRole) ? "Sales" : "Sales Rep", "Normal customer sale or Promotion Run"],
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

  const promotionRunRequested = appRoute === "#promotion-run";
  const normalSalesRepRequested = appRoute === "#sales-rep";
  const promotionRunAllowed =
    effectiveDuty === "sales_rep" && canAccessPage(profile, "page.order.sales_rep");
  const showSalesRepStart = promotionRunAllowed && !promotionRunRequested && !normalSalesRepRequested;

  const openNormalOrder = () => {
    window.location.hash = "sales-rep";
  };

  const openPromotionRun = () => {
    window.location.hash = "promotion-run";
  };

  if (showSalesRepStart) {
    return (
      <div className="min-h-screen bg-slate-100 p-4 flex items-center justify-center">
        <div className="w-full max-w-2xl rounded-3xl bg-white p-6 shadow-xl">
          <p className="text-xs font-black uppercase tracking-wider text-blue-700">{["Admin", "Super Admin"].includes(normalizedRole) ? "Admin Sales" : "Sales Rep"} · Ask Log</p>
          <h1 className="mt-1 text-2xl font-black text-slate-900">What are you doing now?</h1>
          <p className="mt-2 text-sm text-slate-500">Choose Normal Sale for the full customer/delivery order page, or Promotion Run for an active promotion sale.</p>
          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            <button type="button" onClick={openNormalOrder} className="rounded-2xl border-2 border-blue-200 p-5 text-left hover:border-blue-700 hover:bg-blue-50">
              <strong className="block text-xl text-blue-950">Normal Sale</strong>
              <span className="mt-1 block text-sm text-slate-500">Open the normal customer page to show other products and place an order for delivery.</span>
            </button>
            <button type="button" onClick={openPromotionRun} className="rounded-2xl border-2 border-emerald-200 p-5 text-left hover:border-emerald-700 hover:bg-emerald-50">
              <strong className="block text-xl text-emerald-900">Promotion Run</strong>
              <span className="mt-1 block text-sm text-slate-500">Promotion product sale with Registered or Guest Customer.</span>
            </button>
          </div>
          <button type="button" onClick={handleLogout} className="mt-5 text-sm font-bold text-slate-600">Log out</button>
        </div>
      </div>
    );
  }

  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-slate-100 p-4">
          <div className="text-sm font-bold text-slate-600">Loading FairChoice...</div>
        </div>
      }
    >
      {promotionRunRequested && promotionRunAllowed ? (
        <SalesRepPromotionRun
          userProfile={profile}
          onLogout={handleLogout}
          onBackToOrder={openNormalOrder}
        />
      ) : (
        <CustomerOrder
          userProfile={profile}
          onLogout={handleLogout}
          onProfileRefresh={handleLogin}
          activeDuty={effectiveDuty}
        />
      )}
    </Suspense>
  );
}
