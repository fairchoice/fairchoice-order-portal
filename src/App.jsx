import { useState } from "react";
import CustomerOrder from "./pages/CustomerOrder";
import LoginPage from "./pages/LoginPage";

export default function App() {

  const [profile, setProfile] = useState(null);

  if (!profile) {
    return <LoginPage onLogin={setProfile} />;
  }

  return <CustomerOrder userProfile={profile} />;
}
  