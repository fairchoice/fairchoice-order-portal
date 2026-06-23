import { useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";
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

const PRODUCT_FIELD_BY_OPTION_TYPE = {
  main_category: "main_category",
  sub_category: "sub_category",
  brand: "brand",
  series: "series",
};

const ALLOWED_OPTION_TYPES = new Set(OPTION_TYPES.map((type) => type.optionType));

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
  const [renameModal, setRenameModal] = useState(null);
  const [renameValue, setRenameValue] = useState("");
  const [updateExistingProducts, setUpdateExistingProducts] = useState(false);
  const [categoryImportPreview, setCategoryImportPreview] = useState(null);
  const [importingCategories, setImportingCategories] = useState(false);

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
    setRenameModal(null);
    setRenameValue("");
    setUpdateExistingProducts(false);
  };

  const normalizeText = (value) => String(value || "").trim().toLowerCase();
  const normalizeName = (value) => String(value || "").trim();
  const toImportBool = (value) => {
    if (value === true || value === false) return value;
    const text = String(value ?? "").trim().toLowerCase();
    if (["true", "yes", "y", "1"].includes(text)) return true;
    if (["false", "no", "n", "0"].includes(text)) return false;
    return null;
  };

  const downloadCategoryTemplate = () => {
    const worksheet = XLSX.utils.json_to_sheet([
      { "Option Type": "main_category", "Option Name": "Drinks", Active: true },
      { "Option Type": "sub_category", "Option Name": "Cans", Active: true },
      { "Option Type": "brand", "Option Name": "Coca Cola", Active: true },
      { "Option Type": "series", "Option Name": "Original", Active: true },
    ]);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Categories");
    XLSX.writeFile(workbook, "fairchoice-category-import-template.xlsx");
  };

  const handleCategoryImportFile = async (event) => {
    const file = event.target.files[0];
    event.target.value = "";
    if (!file) return;

    setImportingCategories(true);

    try {
      const data = await file.arrayBuffer();
      const workbook = XLSX.read(data);
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(sheet, { defval: "" });

      const { data: existingOptions, error } = await supabase
        .from("product_options")
        .select("*");

      if (error) throw error;

      const existingByKey = new Map(
        (existingOptions || []).map((option) => [
          `${normalizeText(option.option_type)}:${normalizeText(option.option_name)}`,
          option,
        ])
      );
      const seenKeys = new Set();
      const errors = [];
      const creates = [];
      const updates = [];
      let unchanged = 0;

      rows.forEach((row, index) => {
        const rowNumber = index + 2;
        const optionType = normalizeName(
          row["Option Type"] || row.option_type || row.optionType
        );
        const optionName = normalizeName(
          row["Option Name"] || row.option_name || row.optionName
        );
        const active = toImportBool(row.Active ?? row.active ?? true);
        const key = `${normalizeText(optionType)}:${normalizeText(optionName)}`;

        if (!ALLOWED_OPTION_TYPES.has(optionType)) {
          errors.push({
            rowNumber,
            field: "Option Type",
            message: "Option Type must be main_category, sub_category, brand, or series",
          });
        }

        if (!optionName) {
          errors.push({
            rowNumber,
            field: "Option Name",
            message: "Option Name is required",
          });
        }

        if (active === null) {
          errors.push({
            rowNumber,
            field: "Active",
            message: "Active must be TRUE or FALSE",
          });
        }

        if (seenKeys.has(key)) {
          errors.push({
            rowNumber,
            field: "Option Name",
            message: "Duplicate category option in import file",
          });
        }
        seenKeys.add(key);

        if (!optionType || !optionName || active === null || !ALLOWED_OPTION_TYPES.has(optionType)) {
          return;
        }

        const existing = existingByKey.get(key);

        if (existing) {
          if (Boolean(existing.active) !== Boolean(active)) {
            updates.push({
              id: existing.id,
              option_type: optionType,
              option_name: optionName,
              active,
            });
          } else {
            unchanged += 1;
          }
          return;
        }

        creates.push({
          option_type: optionType,
          option_name: optionName,
          active,
        });
      });

      setCategoryImportPreview({
        rowsChecked: rows.length,
        creates,
        updates,
        unchanged,
        errors,
      });
    } catch (error) {
      alert("Category import preview failed: " + error.message);
    }

    setImportingCategories(false);
  };

  const confirmCategoryImport = async () => {
    if (!categoryImportPreview || categoryImportPreview.errors.length) return;

    const ok = window.confirm(
      [
        `Categories checked: ${categoryImportPreview.rowsChecked}`,
        `Categories created: ${categoryImportPreview.creates.length}`,
        `Categories updated: ${categoryImportPreview.updates.length}`,
        `Categories unchanged: ${categoryImportPreview.unchanged}`,
        "Apply these changes now?",
      ].join("\n")
    );

    if (!ok) return;

    setImportingCategories(true);

    try {
      for (const option of categoryImportPreview.updates) {
        const { error } = await supabase
          .from("product_options")
          .update({ active: option.active })
          .eq("id", option.id);

        if (error) throw error;
      }

      if (categoryImportPreview.creates.length) {
        const { error } = await supabase
          .from("product_options")
          .insert(categoryImportPreview.creates);

        if (error) throw error;
      }

      console.log("Category import applied", categoryImportPreview);
      alert("Category import completed successfully.");
      setCategoryImportPreview(null);
      await fetchProductOptions();
    } catch (error) {
      alert("Category import failed: " + error.message);
    }

    setImportingCategories(false);
  };

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

  const countProductsUsingOption = async (option, config) => {
    const productField = PRODUCT_FIELD_BY_OPTION_TYPE[config?.optionType];
    if (!productField || !option?.option_name) return 0;

    const { count, error } = await supabase
      .from("products")
      .select("id", { count: "exact", head: true })
      .eq(productField, option.option_name);

    if (error) throw error;

    return count || 0;
  };

  const openRenameModal = (option) => {
    if (!activeConfig || !option?.id || busy) return;

    setRenameModal({ option, config: activeConfig });
    setRenameValue(option.option_name || "");
    setUpdateExistingProducts(false);
  };

  const closeRenameModal = () => {
    if (busy) return;

    setRenameModal(null);
    setRenameValue("");
    setUpdateExistingProducts(false);
  };

  const saveRename = async () => {
    if (!renameModal?.option?.id || busy) return;

    const option = renameModal.option;
    const config = renameModal.config;
    const oldName = String(option.option_name || "").trim();
    const newName = renameValue.trim();
    const productField = PRODUCT_FIELD_BY_OPTION_TYPE[config?.optionType];

    if (!newName) {
      alert("Enter a new name.");
      return;
    }

    if (newName === oldName) {
      closeRenameModal();
      return;
    }

    const confirmed = window.confirm(
      `Rename '${oldName}' to '${newName}'?`
    );
    if (!confirmed) return;

    setBusy(true);

    try {
      const { error } = await supabase
        .from("product_options")
        .update({ option_name: newName })
        .eq("id", option.id);

      if (error) throw error;

      if (updateExistingProducts && productField) {
        const { error: productsError } = await supabase
          .from("products")
          .update({ [productField]: newName })
          .eq(productField, oldName);

        if (productsError) throw productsError;
      }

      await fetchProductOptions();
      setRenameModal(null);
      setRenameValue("");
      setUpdateExistingProducts(false);
    } catch (error) {
      alert(error.message);
    }

    setBusy(false);
  };

  const deleteOption = async (option) => {
    if (!option?.id || busy || !activeConfig) return;

    setBusy(true);

    try {
      const productCount = await countProductsUsingOption(option, activeConfig);
      const confirmed =
        productCount > 0
          ? window.confirm(
              `This category is currently used by ${productCount} products.\n\nDelete anyway?`
            )
          : window.confirm(`Delete "${option.option_name}"?`);

      if (!confirmed) {
        setBusy(false);
        return;
      }

      const { error } = await supabase
        .from("product_options")
        .update({ active: false })
        .eq("id", option.id);

      if (error) throw error;

      await fetchProductOptions();
    } catch (error) {
      alert(error.message);
    }

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

      <div className="mb-5 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h3 className="font-bold text-slate-900">Category Import</h3>
            <p className="mt-1 text-sm text-slate-600">
              Import category options separately from product import. Existing names update active status only.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={downloadCategoryTemplate}
              className="rounded-xl bg-slate-700 px-4 py-3 text-sm font-bold text-white"
            >
              Download Category Template
            </button>

            <label className="cursor-pointer rounded-xl bg-blue-700 px-4 py-3 text-sm font-bold text-white">
              <input
                type="file"
                accept=".xlsx,.csv"
                onChange={handleCategoryImportFile}
                disabled={importingCategories}
                className="hidden"
              />
              Upload Category File
            </label>
          </div>
        </div>

        {categoryImportPreview && (
          <div className="mt-4 rounded-xl border border-slate-200 p-4">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div className="grid grid-cols-2 gap-3 text-sm md:grid-cols-5">
                <div><strong>Checked:</strong> {categoryImportPreview.rowsChecked}</div>
                <div><strong>Created:</strong> {categoryImportPreview.creates.length}</div>
                <div><strong>Updated:</strong> {categoryImportPreview.updates.length}</div>
                <div><strong>Unchanged:</strong> {categoryImportPreview.unchanged}</div>
                <div><strong>Errors:</strong> {categoryImportPreview.errors.length}</div>
              </div>

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setCategoryImportPreview(null)}
                  className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-bold"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={confirmCategoryImport}
                  disabled={categoryImportPreview.errors.length > 0 || importingCategories}
                  className="rounded-lg bg-green-700 px-3 py-2 text-sm font-bold text-white disabled:bg-slate-300"
                >
                  Confirm Import
                </button>
              </div>
            </div>

            {categoryImportPreview.errors.length > 0 && (
              <div className="mt-3 max-h-56 overflow-auto rounded-lg border">
                <table className="w-full text-sm">
                  <thead className="bg-red-50 text-red-700">
                    <tr>
                      <th className="p-2 text-left">Row</th>
                      <th className="p-2 text-left">Field</th>
                      <th className="p-2 text-left">Error</th>
                    </tr>
                  </thead>
                  <tbody>
                    {categoryImportPreview.errors.map((error, index) => (
                      <tr key={`${error.rowNumber}-${error.field}-${index}`} className="border-t">
                        <td className="p-2">{error.rowNumber}</td>
                        <td className="p-2">{error.field}</td>
                        <td className="p-2">{error.message}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
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
                  <>
                  <div className="hidden grid-cols-[1fr_180px] gap-3 border-b border-slate-200 bg-slate-50 px-4 py-2 text-xs font-bold uppercase tracking-wide text-slate-500 sm:grid">
                    <span>{activeConfig.singular}</span>
                    <span className="text-right">Actions</span>
                  </div>

                  <ul className="divide-y divide-slate-200">
                    {filteredOptions.map((option) => (
                      <li
                        key={option.id}
                        className="grid min-h-12 grid-cols-1 gap-3 bg-white px-4 py-3 sm:grid-cols-[1fr_180px] sm:items-center"
                      >
                        <span className="min-w-0 flex-1 break-words text-sm font-semibold text-slate-900">
                          {option.option_name}
                        </span>
                        <div className="flex items-center gap-2 sm:justify-end">
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => openRenameModal(option)}
                            className="rounded-lg border border-blue-200 px-3 py-2 text-sm font-bold text-blue-700 hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            Rename
                          </button>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => deleteOption(option)}
                            className="rounded-lg border border-red-200 px-3 py-2 text-sm font-bold text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            Delete
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {renameModal && (
        <div className="fixed inset-0 z-[60] flex items-end bg-slate-950/60 p-0 sm:items-center sm:p-4">
          <button
            type="button"
            className="absolute inset-0 cursor-default"
            aria-label="Close rename category"
            onClick={closeRenameModal}
          />

          <div className="relative mx-auto w-full max-w-md rounded-t-2xl bg-white p-5 shadow-2xl sm:rounded-2xl">
            <h3 className="text-xl font-bold text-slate-900">
              Rename {renameModal.config.singular}
            </h3>

            <div className="mt-4 space-y-4">
              <div>
                <p className="text-sm font-bold text-slate-800">Current Name:</p>
                <p className="mt-1 rounded-xl bg-slate-100 px-3 py-2 text-sm font-semibold text-slate-900">
                  {renameModal.option.option_name}
                </p>
              </div>

              <label className="block">
                <span className="text-sm font-bold text-slate-800">New Name:</span>
                <input
                  type="text"
                  value={renameValue}
                  onChange={(event) => setRenameValue(event.target.value)}
                  className="mt-2 w-full rounded-xl border border-slate-300 px-3 py-3 text-base outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100"
                  autoFocus
                />
              </label>

              <label className="flex items-start gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm font-semibold text-slate-800">
                <input
                  type="checkbox"
                  checked={updateExistingProducts}
                  onChange={(event) =>
                    setUpdateExistingProducts(event.target.checked)
                  }
                  className="mt-1 h-4 w-4"
                />
                <span>Update existing products</span>
              </label>
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={closeRenameModal}
                disabled={busy}
                className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={saveRename}
                disabled={busy || !renameValue.trim()}
                className="rounded-lg bg-blue-700 px-4 py-2 text-sm font-bold text-white hover:bg-blue-800 disabled:cursor-not-allowed disabled:bg-slate-300"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
