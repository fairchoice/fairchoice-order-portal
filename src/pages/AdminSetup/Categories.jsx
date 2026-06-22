import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../services/supabase";

const OPTION_TYPES = [
  {
    key: "mainCategories",
    optionType: "main_category",
    title: "Main Categories",
    singular: "Main Category",
  },
  {
    key: "subCategories",
    optionType: "sub_category",
    title: "Sub Categories",
    singular: "Sub Category",
  },
  {
    key: "brands",
    optionType: "brand",
    title: "Brands",
    singular: "Brand",
  },
  {
    key: "series",
    optionType: "series",
    title: "Series",
    singular: "Series",
  },
];

function countLabel(count) {
  return `${count} ${count === 1 ? "Option" : "Options"}`;
}

export default function Categories() {
  const [productOptions, setProductOptions] = useState([]);
  const [activeType, setActiveType] = useState(null);
  const [search, setSearch] = useState("");
  const [newOption, setNewOption] = useState("");
  const [busy, setBusy] = useState(false);
  const [generatingAccounts, setGeneratingAccounts] = useState(false);

  useEffect(() => {
    fetchProductOptions();
  }, []);

  const fetchProductOptions = async () => {
    const { data, error } = await supabase
      .from("product_options")
      .select("*")
      .eq("active", true)
      .order("option_type")
      .order("option_name");

    if (error) {
      alert(error.message);
      return;
    }

    setProductOptions(data || []);
  };

  const groupedOptions = useMemo(() => {
    return OPTION_TYPES.reduce((groups, type) => {
      groups[type.key] = productOptions.filter(
        (option) => option.option_type === type.optionType
      );
      return groups;
    }, {});
  }, [productOptions]);

  const activeConfig = OPTION_TYPES.find((type) => type.key === activeType);
  const activeOptions = activeConfig ? groupedOptions[activeConfig.key] || [] : [];

  const filteredOptions = useMemo(() => {
    const searchText = search.trim().toLowerCase();
    if (!searchText) return activeOptions;

    return activeOptions.filter((option) =>
      String(option.option_name || "").toLowerCase().includes(searchText)
    );
  }, [activeOptions, search]);

  const openManager = (typeKey) => {
    setActiveType(typeKey);
    setSearch("");
    setNewOption("");
  };

  const closeManager = () => {
    setActiveType(null);
    setSearch("");
    setNewOption("");
    setBusy(false);
  };

  const normalizeText = (value) => String(value || "").trim().toLowerCase();

  const getNextAvailableAccountCode = (usedCodes, baseCode) => {
    let code = baseCode;

    while (usedCodes.has(String(code))) {
      code += 10;
    }

    usedCodes.add(String(code));
    return String(code);
  };

  const buildMissingAccountRows = (mainCategories, accountCodes) => {
    const usedSalesCodes = new Set(
      (accountCodes || [])
        .filter(
          (account) =>
            String(account.account_type || "").trim().toLowerCase() === "sales"
        )
        .map((account) => String(account.account_code || "").trim())
        .filter(Boolean)
    );

    const usedPurchaseCodes = new Set(
      (accountCodes || [])
        .filter(
          (account) =>
            String(account.account_type || "").trim().toLowerCase() === "purchase"
        )
        .map((account) => String(account.account_code || "").trim())
        .filter(Boolean)
    );

    const existingKeys = new Set(
      (accountCodes || []).map(
        (account) =>
          `${normalizeText(account.account_type)}:${normalizeText(account.main_category)}`
      )
    );

    const rowsToInsert = [];
    const categoryKeysSeen = new Set();

    mainCategories.forEach((category) => {
      const mainCategory = String(category || "").trim();
      if (!mainCategory) return;

      const categoryKey = normalizeText(mainCategory);
      if (categoryKeysSeen.has(categoryKey)) return;

      categoryKeysSeen.add(categoryKey);

      const salesKey = `sales:${categoryKey}`;
      const purchaseKey = `purchase:${categoryKey}`;

      if (!existingKeys.has(salesKey)) {
        rowsToInsert.push({
          account_code: getNextAvailableAccountCode(usedSalesCodes, 4000),
          account_name: `Sales - ${mainCategory}`,
          account_type: "Sales",
          main_category: mainCategory,
          active: true,
        });
        existingKeys.add(salesKey);
      }

      if (!existingKeys.has(purchaseKey)) {
        rowsToInsert.push({
          account_code: getNextAvailableAccountCode(usedPurchaseCodes, 5000),
          account_name: `Purchases - ${mainCategory}`,
          account_type: "Purchase",
          main_category: mainCategory,
          active: true,
        });
        existingKeys.add(purchaseKey);
      }
    });

    return rowsToInsert;
  };

  const insertMissingAccountRows = async (rowsToInsert) => {
    let createdCount = 0;

    for (const row of rowsToInsert) {
      console.log("Inserting account code row:", row);

      const { error } = await supabase.from("account_codes").insert(row);

      if (error) {
        console.error("Supabase account_codes insert error:", {
          row,
          error,
        });

        alert(
          `Supabase insert error:\n\n${JSON.stringify(
            {
              row,
              error,
            },
            null,
            2
          )}`
        );

        if (error.code === "23505") continue;
        throw error;
      }

      createdCount += 1;
    }

    return createdCount;
  };

  const createAccountsForMainCategory = async (mainCategory) => {
    const { data: accountCodes, error } = await supabase
      .from("account_codes")
      .select("account_code, account_type, main_category");

    if (error) throw error;

    const rowsToInsert = buildMissingAccountRows([mainCategory], accountCodes || []);

    if (rowsToInsert.length === 0) return;

    await insertMissingAccountRows(rowsToInsert);
  };

  const generateAccountsFromCategories = async () => {
    if (generatingAccounts || busy) return;

    setGeneratingAccounts(true);

    try {
      const { data: categories, error: categoryError } = await supabase
        .from("product_options")
        .select("option_name")
        .eq("option_type", "main_category")
        .eq("active", true)
        .order("option_name");

      if (categoryError) throw categoryError;

      const { data: accountCodes, error: accountError } = await supabase
        .from("account_codes")
        .select("account_code, account_type, main_category");

      if (accountError) throw accountError;

      const mainCategories = (categories || []).map(
        (category) => category.option_name
      );
      const rowsToInsert = buildMissingAccountRows(
        mainCategories,
        accountCodes || []
      );

      console.log("Generate Accounts from Categories debug:", {
        mainCategoryCount: mainCategories.length,
        mainCategories,
        existingAccountCodes: accountCodes || [],
        rowsToInsert,
      });

      alert(
        [
          `Main categories found: ${mainCategories.length}`,
          `Category names found: ${mainCategories.join(", ") || "None"}`,
          `rowsToInsert: ${JSON.stringify(rowsToInsert, null, 2)}`,
        ].join("\n\n")
      );

      const createdCount =
        rowsToInsert.length > 0 ? await insertMissingAccountRows(rowsToInsert) : 0;

      alert(`${createdCount} account codes created`);
    } catch (error) {
      console.error("Generate Accounts from Categories failed:", error);
      alert("Could not generate accounts: " + error.message);
    }

    setGeneratingAccounts(false);
  };

  const addOption = async (event) => {
    event.preventDefault();

    const optionName = newOption.trim();
    if (!activeConfig || !optionName || busy) return;

    setBusy(true);

    const { error } = await supabase.from("product_options").insert({
      option_type: activeConfig.optionType,
      option_name: optionName,
      active: true,
    });

    if (error) {
      alert(error.message);
      setBusy(false);
      return;
    }

    if (activeConfig.optionType === "main_category") {
      try {
        await createAccountsForMainCategory(optionName);
      } catch (accountError) {
        alert(
          `Main Category was created, but account codes could not be created.\n\n${accountError.message}`
        );
      }
    }

    setNewOption("");
    await fetchProductOptions();
    setBusy(false);
  };

  const deleteOption = async (option) => {
    if (!option?.id || busy) return;

    const confirmed = window.confirm(
      `Delete "${option.option_name}"? This cannot be undone.`
    );
    if (!confirmed) return;

    setBusy(true);

    const { error } = await supabase
      .from("product_options")
      .update({ active: false })
      .eq("id", option.id);

    if (error) {
      alert(error.message);
      setBusy(false);
      return;
    }

    await fetchProductOptions();
    setBusy(false);
  };

  return (
    <div className="p-4 max-w-6xl mx-auto bg-slate-50 min-h-screen">
      <div className="mb-5">
        <h2 className="text-2xl font-bold text-slate-900">Categories</h2>
        <p className="mt-1 text-sm text-slate-600">
          Manage Main Categories, Sub Categories, Brands and Series.
        </p>
      </div>

      <div className="mb-5 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="font-bold text-slate-900">Account Setup</h3>
            <p className="mt-1 text-sm text-slate-600">
              Create missing Sales and Purchase accounts from active Main Categories.
            </p>
          </div>

          <button
            type="button"
            onClick={generateAccountsFromCategories}
            disabled={generatingAccounts || busy}
            className="inline-flex min-h-11 items-center justify-center rounded-xl bg-green-700 px-5 py-3 text-sm font-bold text-white shadow-sm hover:bg-green-800 disabled:cursor-not-allowed disabled:bg-slate-300"
          >
            {generatingAccounts
              ? "Generating..."
              : "Generate Accounts from Categories"}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {OPTION_TYPES.map((type) => {
          const total = groupedOptions[type.key]?.length || 0;

          return (
            <article
              key={type.key}
              className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
            >
              <p className="text-xs font-semibold uppercase tracking-wide text-blue-700">
                Category Type
              </p>
              <h3 className="mt-1 text-lg font-bold text-slate-900">{type.title}</h3>
              <p className="mt-3 text-3xl font-extrabold text-slate-900">{total}</p>
              <p className="text-sm font-medium text-slate-500">{countLabel(total)}</p>

              <button
                type="button"
                onClick={() => openManager(type.key)}
                className="mt-4 inline-flex min-h-11 w-full items-center justify-center rounded-xl bg-blue-700 px-4 py-2 text-sm font-bold text-white shadow-sm hover:bg-blue-800 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
              >
                Manage
              </button>
            </article>
          );
        })}
      </div>

      {activeConfig && (
        <div className="fixed inset-0 z-50 flex items-end bg-slate-950/50 p-0 sm:items-center sm:p-4">
          <button
            type="button"
            className="absolute inset-0 cursor-default"
            aria-label="Close category manager"
            onClick={closeManager}
          />

          <div className="relative mx-auto flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-t-2xl bg-white shadow-2xl sm:rounded-2xl">
            <header className="border-b border-slate-200 p-4 sm:p-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-blue-700">
                    Categories
                  </p>
                  <h3 className="text-xl font-bold text-slate-900">
                    {activeConfig.title}
                  </h3>
                  <p className="mt-1 text-sm text-slate-600">
                    {countLabel(activeOptions.length)}
                  </p>
                </div>

                <button
                  type="button"
                  onClick={closeManager}
                  className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50"
                >
                  Close
                </button>
              </div>
            </header>

            <div className="space-y-4 overflow-y-auto p-4 sm:p-5">
              <label className="block">
                <span className="text-sm font-bold text-slate-800">
                  Search {activeConfig.singular}
                </span>
                <input
                  type="search"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  className="mt-2 w-full rounded-xl border border-slate-300 px-3 py-3 text-base outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100"
                  placeholder={`Search ${activeConfig.title.toLowerCase()}`}
                />
              </label>

              <form onSubmit={addOption} className="block sm:flex sm:items-end sm:gap-3">
                <label className="block flex-1">
                  <span className="text-sm font-bold text-slate-800">
                    Add {activeConfig.singular}
                  </span>
                  <input
                    type="text"
                    value={newOption}
                    onChange={(event) => setNewOption(event.target.value)}
                    className="mt-2 w-full rounded-xl border border-slate-300 px-3 py-3 text-base outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100"
                    placeholder={`New ${activeConfig.singular.toLowerCase()}`}
                  />
                </label>

                <button
                  type="submit"
                  disabled={busy || !newOption.trim()}
                  className="mt-3 inline-flex min-h-11 w-full items-center justify-center rounded-xl bg-blue-700 px-5 py-3 text-sm font-bold text-white shadow-sm hover:bg-blue-800 disabled:cursor-not-allowed disabled:bg-slate-300 sm:mt-0 sm:w-auto"
                >
                  Add
                </button>
              </form>

              <div className="overflow-hidden rounded-xl border border-slate-200">
                {filteredOptions.length === 0 ? (
                  <div className="p-5 text-sm text-slate-600">
                    No {activeConfig.title.toLowerCase()} found.
                  </div>
                ) : (
                  <ul className="divide-y divide-slate-200">
                    {filteredOptions.map((option) => (
                      <li
                        key={option.id}
                        className="flex min-h-12 items-center justify-between gap-3 bg-white px-4 py-3"
                      >
                        <span className="min-w-0 flex-1 break-words text-sm font-semibold text-slate-900">
                          {option.option_name}
                        </span>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => deleteOption(option)}
                          className="rounded-lg border border-red-200 px-3 py-2 text-sm font-bold text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          Delete
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
