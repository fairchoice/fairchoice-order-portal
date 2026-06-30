import { useEffect, useState } from "react";
import CustomerOrder from "./pages/CustomerOrder";
import LoginPage from "./pages/AdminSetup/LoginPage";

import PriceManagement from "./pages/AdminSetup/PriceManagement";
import PricingRule from "./pages/AdminSetup/PricingRule";

const SESSION_KEY = "fairchoice_user";
const LAST_ACTIVE_KEY = "fairchoice_last_active";
const SESSION_TIMEOUT = 10 * 60 * 1000; // 10 minutes

export default function App() {
  const [profile, setProfile] = useState(() => {
    try {
      const savedProfile = localStorage.getItem(SESSION_KEY);
      const lastActive = Number(localStorage.getItem(LAST_ACTIVE_KEY) || 0);

      if (savedProfile && Date.now() - lastActive < SESSION_TIMEOUT) {
        return JSON.parse(savedProfile);
      }

      localStorage.removeItem(SESSION_KEY);
      localStorage.removeItem(LAST_ACTIVE_KEY);
      return null;
    } catch {
      return null;
    }
  });

  const handleLogin = (userProfile) => {
    localStorage.setItem(SESSION_KEY, JSON.stringify(userProfile));
    localStorage.setItem(LAST_ACTIVE_KEY, Date.now().toString());
    setProfile(userProfile);
  };

  useEffect(() => {
    if (!profile) return;

    const updateActivity = () => {
      localStorage.setItem(LAST_ACTIVE_KEY, Date.now().toString());
    };

    const checkTimeout = () => {
      const lastActive = Number(localStorage.getItem(LAST_ACTIVE_KEY) || 0);

      if (Date.now() - lastActive > SESSION_TIMEOUT) {
        localStorage.removeItem(SESSION_KEY);
        localStorage.removeItem(LAST_ACTIVE_KEY);
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

  if (!profile) {
    return <LoginPage onLogin={handleLogin} />;
  }

  return <CustomerOrder userProfile={profile} />;
}