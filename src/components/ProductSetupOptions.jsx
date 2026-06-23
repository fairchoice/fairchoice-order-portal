import React, { useMemo, useState } from "react";

const OPTION_TYPES = [
  {
    key: "mainCategories",
    title: "Main Categories",
    singular: "Main Category",
  },
  {
    key: "subCategories",
    title: "Sub Categories",
    singular: "Sub Category",
  },
  {
    key: "brands",
    title: "Brands",
    singular: "Brand",
  },
  {
    key: "series",
    title: "Series",
    singular: "Series",
  },
];

function getOptionLabel(option) {
  if (typeof option === "string") return option;
  return (
    option?.option_name ||
    option?.name ||
    option?.label ||
    option?.value ||
    option?.option_value ||
    ""
  );
}

function getOptionId(option) {
  if (typeof option === "string") return option;
  return (
    option?.id ||
    option?.option_name ||
    option?.value ||
    option?.option_value ||
    option?.name ||
    option?.label
  );
}

function countLabel(count) {
  return `${count} ${count === 1 ? "Option" : "Options"}`;
}

export default function ProductSetupOptions({
  optionsByType,
  onAddOption,
  onDeleteOption,
}) {
  const [activeType, setActiveType] = useState(null);
  const [search, setSearch] = useState("");
  const [newOption, setNewOption] = useState("");
  const [busy, setBusy] = useState(false);

  const activeConfig = OPTION_TYPES.find((item) => item.key === activeType);
  const activeOptions = activeType ? optionsByType?.[activeType] || [] : [];

  const filteredOptions = useMemo(() => {
    const searchText = search.trim().toLowerCase();
    if (!searchText) return activeOptions;

    return activeOptions.filter((option) =>
      getOptionLabel(option).toLowerCase().includes(searchText)
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

  const handleAdd = async (event) => {
    event.preventDefault();

    const value = newOption.trim();
    if (!value || !activeType || busy) return;

    setBusy(true);
    try {
      await onAddOption(activeType, value);
      setNewOption("");
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async (option) => {
    const label = getOptionLabel(option);
    if (!label || busy) return;

    const confirmed = window.confirm(`Delete "${label}"? This cannot be undone.`);
    if (!confirmed) return;

    setBusy(true);
    try {
      await onDeleteOption(activeType, option);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="w-full">
      <div className="mb-4">
        <h2 className="text-xl font-bold text-slate-900 sm:text-2xl">Product Setup</h2>
        <p className="mt-1 text-sm text-slate-600">
          Manage product dropdown options without loading every chip on the main screen.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {OPTION_TYPES.map((type) => {
          const total = optionsByType?.[type.key]?.length || 0;

          return (
            <article
              key={type.key}
              className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
            >
              <div className="flex min-h-28 flex-col justify-between">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-blue-700">
                    Option Type
                  </p>
                  <h3 className="mt-1 text-lg font-bold text-slate-900">{type.title}</h3>
                  <p className="mt-2 text-3xl font-extrabold text-slate-900">{total}</p>
                  <p className="text-sm font-medium text-slate-500">{countLabel(total)}</p>
                </div>

                <button
                  type="button"
                  onClick={() => openManager(type.key)}
                  className="mt-4 inline-flex min-h-11 items-center justify-center rounded-lg bg-blue-700 px-4 py-2 text-sm font-bold text-white shadow-sm transition hover:bg-blue-800 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
                >
                  Manage
                </button>
              </div>
            </article>
          );
        })}
      </div>

      {activeConfig && (
        <div className="fixed inset-0 z-50 flex items-end bg-slate-950/50 p-0 sm:items-center sm:p-4">
          <div
            className="absolute inset-0"
            aria-label="Close Product Setup manager"
            role="button"
            tabIndex={0}
            onClick={closeManager}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === "Escape") closeManager();
            }}
          />

          <div className="relative mx-auto flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-t-2xl bg-white shadow-2xl sm:rounded-2xl">
            <header className="border-b border-slate-200 p-4 sm:p-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-blue-700">
                    Product Setup
                  </p>
                  <h3 className="text-xl font-bold text-slate-900">{activeConfig.title}</h3>
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
                  className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-3 text-base outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100"
                  placeholder={`Search ${activeConfig.title.toLowerCase()}`}
                />
              </label>

              <form onSubmit={handleAdd} className="block sm:flex sm:items-end sm:gap-3">
                <label className="block flex-1">
                  <span className="text-sm font-bold text-slate-800">
                    Add {activeConfig.singular}
                  </span>
                  <input
                    type="text"
                    value={newOption}
                    onChange={(event) => setNewOption(event.target.value)}
                    className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-3 text-base outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100"
                    placeholder={`New ${activeConfig.singular.toLowerCase()}`}
                  />
                </label>
                <button
                  type="submit"
                  disabled={busy || !newOption.trim()}
                  className="mt-3 inline-flex min-h-11 w-full items-center justify-center rounded-lg bg-blue-700 px-5 py-3 text-sm font-bold text-white shadow-sm hover:bg-blue-800 disabled:cursor-not-allowed disabled:bg-slate-300 sm:mt-0 sm:w-auto"
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
                    {filteredOptions.map((option) => {
                      const label = getOptionLabel(option);

                      return (
                        <li
                          key={getOptionId(option)}
                          className="flex min-h-12 items-center justify-between gap-3 bg-white px-4 py-3"
                        >
                          <span className="min-w-0 flex-1 break-words text-sm font-semibold text-slate-900">
                            {label}
                          </span>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => handleDelete(option)}
                            className="rounded-lg border border-red-200 px-3 py-2 text-sm font-bold text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            Delete
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
