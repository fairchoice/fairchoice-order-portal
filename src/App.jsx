import { useEffect, useState } from "react";
import CustomerOrder from "./pages/CustomerOrder";
import LoginPage from "./pages/AdminSetup/LoginPage";

import PriceManagement from "./pages/AdminSetup/PriceManagement";
import PricingRule from "./pages/AdminSetup/PricingRule";
import {
  clearFcSessionStorage,
  mergeAuthenticatedProfile,
} from "./services/fcSession";

const SESSION_KEY = "fairchoice_user";
const LAST_ACTIVE_KEY = "fairchoice_last_active";
const SESSION_TIMEOUT = 10 * 60 * 1000; // 10 minutes

function clearLegacyProfileStorage() {
  clearFcSessionStorage(localStorage);
}

function storeCompatibleProfile(profile) {
  localStorage.setItem(SESSION_KEY, JSON.stringify(profile));
  localStorage.setItem("loggedInUser", JSON.stringify(profile));
  localStorage.setItem("loginPortal", "staff");
  localStorage.setItem(LAST_ACTIVE_KEY, Date.now().toString());
}

function loadCompatibleProfile() {
  try {
    const savedProfile = JSON.parse(
      localStorage.getItem(SESSION_KEY) || localStorage.getItem("loggedInUser") || "null"
    );
    const lastActive = Number(localStorage.getItem(LAST_ACTIVE_KEY) || 0);

    if (
      !savedProfile ||
      !lastActive ||
      Date.now() - lastActive > SESSION_TIMEOUT
    ) {
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
    setProfile(null);
  };

  useEffect(() => {
    if (!profile) return;

    const updateActivity = () => {
      localStorage.setItem(LAST_ACTIVE_KEY, Date.now().toString());
    };

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

  return (
    <CustomerOrder
      userProfile={profile}
      onLogout={handleLogout}
      onProfileRefresh={handleLogin}
    />
  );
}
