import { useEffect, useState } from "react";
import CustomerOrder from "./pages/CustomerOrder";
import LoginPage from "./pages/AdminSetup/LoginPage";
import { supabase } from "./services/supabase";
import { loadAuthenticatedStaffProfile } from "./services/authProfile";

import PriceManagement from "./pages/AdminSetup/PriceManagement";
import PricingRule from "./pages/AdminSetup/PricingRule";

const SESSION_KEY = "fairchoice_user";
const LAST_ACTIVE_KEY = "fairchoice_last_active";
const SESSION_TIMEOUT = 10 * 60 * 1000; // 10 minutes

function clearLegacyProfileStorage() {
  localStorage.removeItem(SESSION_KEY);
  localStorage.removeItem("loggedInUser");
  localStorage.removeItem("loginPortal");
  localStorage.removeItem(LAST_ACTIVE_KEY);
}

function storeCompatibleProfile(profile) {
  localStorage.setItem(SESSION_KEY, JSON.stringify(profile));
  localStorage.setItem("loggedInUser", JSON.stringify(profile));
  localStorage.setItem("loginPortal", "staff");
  localStorage.setItem(LAST_ACTIVE_KEY, Date.now().toString());
}

export default function App() {
  const [profile, setProfile] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);

  useEffect(() => {
    let active = true;

    const applySession = async (session) => {
      if (!session) {
        clearLegacyProfileStorage();
        if (active) {
          setProfile(null);
          setAuthLoading(false);
        }
        return;
      }

      try {
        const authenticatedProfile = await loadAuthenticatedStaffProfile(
          supabase,
          session
        );

        storeCompatibleProfile(authenticatedProfile);
        if (active) {
          setProfile(authenticatedProfile);
        }
      } catch (error) {
        clearLegacyProfileStorage();
        await supabase.auth.signOut();
        if (active) {
          setProfile(null);
        }
        console.error(error);
      } finally {
        if (active) {
          setAuthLoading(false);
        }
      }
    };

    supabase.auth.getSession().then(({ data, error }) => {
      if (error) {
        console.error("Could not restore Supabase Auth session", error);
        clearLegacyProfileStorage();
        if (active) {
          setProfile(null);
          setAuthLoading(false);
        }
        return;
      }

      applySession(data.session);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      applySession(session);
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  const handleLogin = (userProfile) => {
    storeCompatibleProfile(userProfile);
    setProfile(userProfile);
  };

  useEffect(() => {
    if (!profile) return;

    const updateActivity = () => {
      localStorage.setItem(LAST_ACTIVE_KEY, Date.now().toString());
    };

    const checkTimeout = async () => {
      const lastActive = Number(localStorage.getItem(LAST_ACTIVE_KEY) || 0);

      if (Date.now() - lastActive > SESSION_TIMEOUT) {
        clearLegacyProfileStorage();
        setProfile(null);
        await supabase.auth.signOut();
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

  return <CustomerOrder userProfile={profile} />;
}
