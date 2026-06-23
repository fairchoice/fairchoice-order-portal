import { useState } from "react";
import { supabase } from "../../services/supabase";


const DEFAULT_PERMISSIONS = {
  "Super Admin": {
    access_received_orders: true,
    access_warehouse: true,
    access_driver: true,
    access_sales_rep: true,
    access_customer_portal: true,
    access_customer_setup: true,
    access_product_setup: true,
    access_accounts: true,
    access_reports: true,
    can_receive_order: true,
    can_change_order_status_in_progress: true,
    can_add_product_to_order: true,
    can_move_to_warehouse: true,
    can_print: true,
    can_cancel_order: true,
    can_archive_order: true,
    can_edit_pricing: true,
    can_edit_security: true,
  },
  Admin: {
    access_received_orders: true,
    access_warehouse: true,
    access_driver: true,
    access_sales_rep: true,
    access_customer_portal: true,
    access_customer_setup: true,
    access_product_setup: true,
    access_accounts: true,
    access_reports: true,
    can_receive_order: true,
    can_change_order_status_in_progress: true,
    can_add_product_to_order: true,
    can_move_to_warehouse: true,
    can_print: true,
    can_cancel_order: true,
    can_archive_order: true,
    can_edit_pricing: true,
    can_edit_security: false,
  },
  Warehouse: {
    access_received_orders: true,
    access_warehouse: true,
    access_driver: false,
    access_sales_rep: false,
    access_customer_portal: false,
    access_customer_setup: false,
    access_product_setup: false,
    access_accounts: false,
    access_reports: false,
    can_receive_order: true,
    can_change_order_status_in_progress: true,
    can_add_product_to_order: true,
    can_move_to_warehouse: true,
    can_print: true,
    can_cancel_order: false,
    can_archive_order: false,
    can_edit_pricing: false,
    can_edit_security: false,
  },
  Driver: {
    access_received_orders: false,
    access_warehouse: false,
    access_driver: true,
    access_sales_rep: false,
    access_customer_portal: false,
    access_customer_setup: false,
    access_product_setup: false,
    access_accounts: false,
    access_reports: false,
    can_receive_order: false,
    can_change_order_status_in_progress: false,
    can_add_product_to_order: false,
    can_move_to_warehouse: false,
    can_print: false,
    can_cancel_order: false,
    can_archive_order: false,
    can_edit_pricing: false,
    can_edit_security: false,
  },
  "Sales Rep": {
    access_received_orders: false,
    access_warehouse: false,
    access_driver: false,
    access_sales_rep: true,
    access_customer_portal: false,
    access_customer_setup: false,
    access_product_setup: false,
    access_accounts: false,
    access_reports: false,
    can_receive_order: false,
    can_change_order_status_in_progress: false,
    can_add_product_to_order: false,
    can_move_to_warehouse: false,
    can_print: false,
    can_cancel_order: false,
    can_archive_order: false,
    can_edit_pricing: false,
    can_edit_security: false,
  },
};

const STAFF_ROLES_REQUIRING_STAFF_RECORD = ["Sales Rep", "Driver", "Warehouse"];

const TRADE_BUSINESS_TYPES = [
  "Off Licence",
  "Restaurant",
];

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

function getDefaultPermissions(role) {
  return DEFAULT_PERMISSIONS[role] || {};
}

function mergePermissions(role, savedPermissions) {
  return {
    ...getDefaultPermissions(role),
    ...(savedPermissions || {}),
  };
}

export default function LoginPage({ onLogin }) {
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [showTradeApplication, setShowTradeApplication] = useState(false);
  const [tradeApplicationForm, setTradeApplicationForm] = useState(
    emptyTradeApplicationForm
  );
  const [submittingTradeApplication, setSubmittingTradeApplication] =
    useState(false);

  const submitLogin = async () => {
    const cleanLogin = login.trim().toLowerCase();
    const cleanPassword = password.trim();

    const { data: loginData, error: loginError } = await supabase
      .from("login_users")
      .select("*")
      .or(`username.eq.${cleanLogin},email.eq.${cleanLogin}`)
      .eq("password", cleanPassword)
      .eq("active", true)
      .limit(1);

    if (loginError || !loginData || loginData.length === 0) {
      alert("Invalid username or password");
      return;
    }

    const loginUser = loginData[0];

    if (loginUser.role === "Customer") {
      if (!loginUser.customer_account_id) {
        alert("Login blocked. This customer login is not linked to a customer account.");
        return;
      }

      const loggedInUser = {
        id: loginUser.id,
        username: loginUser.username,
        role: "Customer",
        access_level: "Customer",
        permissions: {
          access_customer_portal: true,
        },
        customer_account_id: loginUser.customer_account_id,
        staff_id: null,
        staff_name: null,
      };

      await supabase.from("audit_logs").insert({
        user_id: loggedInUser.id,
        username: loggedInUser.username,
        staff_name: null,
        role_access_level: loggedInUser.access_level,
        action_type: "Customer Login",
        page_module: "Customer Login",
        order_id: null,
        product_id: null,
        old_value: null,
        new_value: null,
        created_at: new Date().toISOString(),
      });

      localStorage.setItem("fairchoice_user", JSON.stringify(loggedInUser));
      localStorage.setItem("loggedInUser", JSON.stringify(loggedInUser));
      localStorage.setItem("loginPortal", "customer");
      window.location.hash = "#customerPortal";

      onLogin(loggedInUser);
      return;
    }

    let linkedStaff = null;

    if (STAFF_ROLES_REQUIRING_STAFF_RECORD.includes(loginUser.role)) {
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

    const permissions = mergePermissions(loginUser.role, loginUser.permissions);

    const loggedInUser = {
      id: loginUser.id,
      username: loginUser.username,
      role: loginUser.role,
      access_level: loginUser.role,
      permissions,
      staff_id: loginUser.staff_id || null,
      staff_name: linkedStaff?.staff_name || loginUser.username,
      active: loginUser.active,
      customer_account_id: null,
    };

    await supabase.from("audit_logs").insert({
      user_id: loggedInUser.id,
      username: loggedInUser.username,
      staff_name: loggedInUser.staff_name,
      role_access_level: loggedInUser.access_level,
      action_type: "Login",
      page_module: "Login",
      order_id: null,
      product_id: null,
      old_value: null,
      new_value: null,
      created_at: new Date().toISOString(),
    });

    localStorage.setItem("fairchoice_user", JSON.stringify(loggedInUser));
    localStorage.setItem("loggedInUser", JSON.stringify(loggedInUser));
    localStorage.setItem("loginPortal", "staff");

    onLogin(loggedInUser);
  };

  const resetPassword = () => {
    alert("Please contact FairChoice to reset your password.");
  };

  const updateTradeApplicationField = (field, value) => {
    setTradeApplicationForm((prev) => ({
      ...prev,
      [field]: value,
    }));
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
            />

            <input
              className="input-box mb-4"
              type="password"
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />

            <button
              onClick={submitLogin}
              className="w-full bg-blue-600 text-white py-3 rounded-xl font-bold"
            >
              Login
            </button>

            <button
              type="button"
              onClick={resetPassword}
              className="w-full mt-3 text-sm font-bold text-blue-700"
            >
              Reset Password
            </button>

            <button
              type="button"
              onClick={() => setShowTradeApplication((value) => !value)}
              className="mt-5 w-full rounded-xl border border-orange-500 bg-white px-4 py-3 text-sm font-bold text-blue-900 hover:bg-orange-50"
            >
              {showTradeApplication
                ? "Hide Trade Account Registration"
                : "Register for Trade Account"}
            </button>
          </div>

          {showTradeApplication && (
            <form
              onSubmit={submitTradeApplication}
              className="rounded-2xl border border-slate-200 bg-slate-50 p-4"
            >
              <h2 className="mb-3 text-lg font-bold">
                Trade Account Application
              </h2>

              <div className="grid gap-3 md:grid-cols-2">
                <input
                  className="input-box"
                  placeholder="Business Name"
                  value={tradeApplicationForm.business_name}
                  onChange={(e) =>
                    updateTradeApplicationField("business_name", e.target.value)
                  }
                />
                <input
                  className="input-box"
                  placeholder="Contact Name"
                  value={tradeApplicationForm.contact_name}
                  onChange={(e) =>
                    updateTradeApplicationField("contact_name", e.target.value)
                  }
                />
                <input
                  className="input-box"
                  placeholder="Phone Number"
                  value={tradeApplicationForm.phone}
                  onChange={(e) =>
                    updateTradeApplicationField("phone", e.target.value)
                  }
                />
                <input
                  className="input-box"
                  type="email"
                  placeholder="Email"
                  value={tradeApplicationForm.email}
                  onChange={(e) =>
                    updateTradeApplicationField("email", e.target.value)
                  }
                />
                <input
                  className="input-box md:col-span-2"
                  placeholder="Shop Address"
                  value={tradeApplicationForm.shop_address}
                  onChange={(e) =>
                    updateTradeApplicationField("shop_address", e.target.value)
                  }
                />
                <input
                  className="input-box"
                  placeholder="Postcode"
                  value={tradeApplicationForm.postcode}
                  onChange={(e) =>
                    updateTradeApplicationField("postcode", e.target.value)
                  }
                />
                <select
                  className="input-box"
                  value={tradeApplicationForm.country}
                  onChange={(e) =>
                    updateTradeApplicationField("country", e.target.value)
                  }
                >
                  <option value="England">England</option>
                  <option value="Wales">Wales</option>
                </select>
                <select
                  className="input-box"
                  value={tradeApplicationForm.business_type}
                  onChange={(e) =>
                    updateTradeApplicationField("business_type", e.target.value)
                  }
                >
                  {TRADE_BUSINESS_TYPES.map((businessType) => (
                    <option key={businessType} value={businessType}>
                      {businessType}
                    </option>
                  ))}
                </select>
                <input
                  className="input-box"
                  placeholder="VAT Number (optional)"
                  value={tradeApplicationForm.vat_number}
                  onChange={(e) =>
                    updateTradeApplicationField("vat_number", e.target.value)
                  }
                />
                <input
                  className="input-box"
                  placeholder="Company Number (optional)"
                  value={tradeApplicationForm.company_number}
                  onChange={(e) =>
                    updateTradeApplicationField("company_number", e.target.value)
                  }
                />
                <textarea
                  className="input-box min-h-[90px] md:col-span-2"
                  placeholder="Message / Notes"
                  value={tradeApplicationForm.notes}
                  onChange={(e) =>
                    updateTradeApplicationField("notes", e.target.value)
                  }
                />
              </div>

              <button
                type="submit"
                disabled={submittingTradeApplication}
                className="mt-4 w-full rounded-xl bg-orange-600 px-4 py-3 text-sm font-bold text-white disabled:bg-slate-300"
              >
                {submittingTradeApplication
                  ? "Submitting..."
                  : "Submit Application"}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
