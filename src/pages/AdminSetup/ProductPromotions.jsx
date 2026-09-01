import { useEffect, useMemo, useState } from "react";
import { getProducts, isActiveProduct } from "../../services/products";
import {
  ensureDefaultPromotionTypes,
  getPromotionRules,
  getPromotionTypes,
  PROMOTION_LABELS,
  PROMOTION_RULE_KINDS,
  savePromotionRule,
  savePromotionType,
  updateProductPromotionLabels,
  updatePromotionType,
} from "../../services/promotionRules";

const emptyBulkRule = {
  id: "",
  promotion_name: "",
  promotion_type_id: "",
  active: true,
  trigger_brand: "",
  trigger_series: "",
  buy_qty: 10,
  free_brand: "",
  free_series: "",
  free_qty: 1,
  start_date: "",
  end_date: "",
  label_type: "",
};

const emptyPromotionRule = {
  id: "",
  promotion_name: "",
  promotion_type_id: "",
  active: true,
  selectedProductIds: [],
  offer_price: "",
  label_type: "promotion",
  start_date: "",
  end_date: "",
};

const emptyReducedRule = {
  id: "",
  promotion_name: "",
  promotion_type_id: "",
  active: true,
  selectedProductIds: [],
  offer_price: "",
  label_type: "reduced",
  start_date: "",
  end_date: "",
};

const emptyTypeForm = {
  id: "",
  type_name: "",
  active: true,
};

const tabs = [
  "Bulk Buy - Get Free",
  "Promotion Price",
  "Reduced Price",
  "Settings",
];

function Card({ title, children }) {
  return (
    <section className="bg-white border rounded-xl shadow-sm p-4">
      <h2 className="text-lg font-bold text-slate-900 mb-4">{title}</h2>
      {children}
    </section>
  );
}

function Field({ label, children }) {
  return (
    <label className="block">
      <span className="block text-sm font-bold text-slate-700 mb-2">
        {label}
      </span>
      {children}
    </label>
  );
}

function ActiveCheckbox({ checked, onChange }) {
  return (
    <label className="flex items-center gap-3 rounded-xl border border-slate-300 px-4 py-3 min-h-12 bg-white">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className="text-sm font-bold text-slate-800">Active</span>
    </label>
  );
}

function ActiveStatusPill({ active }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-3 py-1 text-sm font-bold ${
        active
          ? "bg-green-100 text-green-800"
          : "bg-slate-200 text-slate-700"
      }`}
    >
      {active ? "Active" : "Inactive"}
    </span>
  );
}

function LabelSelector({ value, onChange }) {
  return (
    <select
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className="border border-slate-300 rounded-xl px-4 py-3 w-full bg-white text-slate-900"
    >
      {PROMOTION_LABELS.map((label) => (
        <option key={label.value || "none"} value={label.value}>
          {label.label}
        </option>
      ))}
    </select>
  );
}

function PromotionTypeSelect({ value, onChange, promotionTypes }) {
  return (
    <select
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className="border border-slate-300 rounded-xl px-4 py-3 w-full bg-white text-slate-900"
    >
      <option value="">Promotion Type</option>
      {promotionTypes.map((type) => (
        <option key={type.id} value={type.id}>
          {type.type_name}
        </option>
      ))}
    </select>
  );
}

function expiryAlert(endDate) {
  if (!endDate) return "No end date";

  const today = new Date();
  const expiry = new Date(`${endDate}T00:00:00`);
  const diffDays = Math.ceil((expiry - today) / (1000 * 60 * 60 * 24));

  if (diffDays < 0) return "Expired";
  if (diffDays <= 7) return `Expires in ${diffDays} day${diffDays === 1 ? "" : "s"}`;
  return "OK";
}

function typeNameById(promotionTypes, id) {
  return promotionTypes.find((type) => String(type.id) === String(id))?.type_name || "";
}

function formatDateRange(rule) {
  const start = rule.start_date || "-";
  const end = rule.end_date || "-";
  return `${start} to ${end}`;
}

function ProductSelector({
  products,
  selectedProductIds,
  onChange,
  search,
  setSearch,
}) {
  const [page, setPage] = useState(1);
  const pageSize = 10;

  const filteredProducts = useMemo(() => {
    const query = String(search || "").trim().toLowerCase();
    if (!query) return [];

    return products.filter((product) =>
      [
        product.productCode,
        product.name,
        product.brand,
        product.series,
        product.flavour,
      ]
        .join(" ")
        .toLowerCase()
        .includes(query)
    );
  }, [products, search]);

  const totalPages = Math.max(1, Math.ceil(filteredProducts.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const visibleProducts = filteredProducts.slice(
    (currentPage - 1) * pageSize,
    currentPage * pageSize
  );

  useEffect(() => {
    setPage(1);
  }, [search]);

  const toggleProduct = (productId) => {
    const exists = selectedProductIds.includes(productId);
    onChange(
      exists
        ? selectedProductIds.filter((id) => id !== productId)
        : [...selectedProductIds, productId]
    );
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-3">
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search Product"
          className="border border-slate-300 rounded-xl px-4 py-3 w-full text-slate-900"
        />
        <button
          type="button"
          className="bg-blue-600 text-white rounded-xl px-4 py-2 font-bold hover:bg-blue-700"
        >
          Search Product
        </button>
      </div>

      {search && (
        <div className="border rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-700 text-white">
              <tr>
                <th className="p-3 text-left">Select</th>
                <th className="p-3 text-left">Product</th>
                <th className="p-3 text-left">Brand</th>
                <th className="p-3 text-left">Series</th>
                <th className="p-3 text-right">Original Price</th>
              </tr>
            </thead>
            <tbody>
              {visibleProducts.map((product) => (
                <tr key={product.id} className="bg-white border-b">
                  <td className="p-3">
                    <input
                      type="checkbox"
                      checked={selectedProductIds.includes(product.id)}
                      onChange={() => toggleProduct(product.id)}
                    />
                  </td>
                  <td className="p-3">
                    <div className="font-bold">{product.name}</div>
                    <div className="text-sm text-slate-500">
                      {product.productCode}
                    </div>
                  </td>
                  <td className="p-3">{product.brand}</td>
                  <td className="p-3">{product.series}</td>
                  <td className="p-3 text-right">
                    GBP {Number(product.vatPrice || product.cashPrice || 0).toFixed(2)}
                  </td>
                </tr>
              ))}
              {!visibleProducts.length && (
                <tr>
                  <td colSpan="5" className="p-4 text-center text-slate-500">
                    No products found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {search && (
        <div className="flex items-center justify-between">
          <button
            type="button"
            disabled={currentPage <= 1}
            onClick={() => setPage((oldPage) => Math.max(1, oldPage - 1))}
            className="bg-blue-600 text-white rounded-xl px-4 py-2 font-bold disabled:opacity-40"
          >
            Previous
          </button>
          <div className="text-sm font-bold">
            Page {currentPage} of {totalPages}
          </div>
          <button
            type="button"
            disabled={currentPage >= totalPages}
            onClick={() => setPage((oldPage) => Math.min(totalPages, oldPage + 1))}
            className="bg-blue-600 text-white rounded-xl px-4 py-2 font-bold disabled:opacity-40"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}

function SelectedProductsList({ products, selectedProductIds }) {
  const selectedProducts = products.filter((product) =>
    selectedProductIds.includes(product.id)
  );

  return (
    <div className="border rounded-xl overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-slate-700 text-white">
          <tr>
            <th className="p-3 text-left">Selected products</th>
            <th className="p-3 text-left">Series</th>
            <th className="p-3 text-right">Original Price</th>
          </tr>
        </thead>
        <tbody>
          {selectedProducts.map((product) => (
            <tr key={product.id} className="bg-white border-b">
              <td className="p-3 font-bold">{product.name}</td>
              <td className="p-3">{product.series}</td>
              <td className="p-3 text-right">
                GBP {Number(product.vatPrice || product.cashPrice || 0).toFixed(2)}
              </td>
            </tr>
          ))}
          {!selectedProducts.length && (
            <tr>
              <td colSpan="3" className="p-4 text-center text-slate-500">
                No products selected.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function ActionButtons({ saving, onSave, onClear, saveLabel = "Save Promotion" }) {
  return (
    <div className="flex flex-wrap gap-3">
      <button
        type="button"
        onClick={onSave}
        disabled={saving}
        className="bg-green-600 text-white rounded-xl px-4 py-2 font-bold hover:bg-green-700 disabled:opacity-40"
      >
        {saving ? "Saving..." : saveLabel}
      </button>
      <button
        type="button"
        onClick={onClear}
        className="bg-white border text-slate-800 rounded-xl px-4 py-2 font-bold hover:bg-slate-50"
      >
        Clear Form
      </button>
    </div>
  );
}

export default function ProductPromotions() {
  const [activeTab, setActiveTab] = useState(tabs[0]);
  const [products, setProducts] = useState([]);
  const [promotionTypes, setPromotionTypes] = useState([]);
  const [rules, setRules] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [bulkRule, setBulkRule] = useState(emptyBulkRule);
  const [promotionRule, setPromotionRule] = useState(emptyPromotionRule);
  const [reducedRule, setReducedRule] = useState(emptyReducedRule);
  const [typeForm, setTypeForm] = useState(emptyTypeForm);
  const [promotionSearch, setPromotionSearch] = useState("");
  const [reducedSearch, setReducedSearch] = useState("");

  const activePromotionTypes = useMemo(
    () => promotionTypes.filter((type) => type.active !== false),
    [promotionTypes]
  );

  const brands = useMemo(
    () => [...new Set(products.map((product) => product.brand).filter(Boolean))],
    [products]
  );

  const buySeries = useMemo(
    () => [
      ...new Set(
        products
          .filter(
            (product) =>
              !bulkRule.trigger_brand ||
              product.brand === bulkRule.trigger_brand
          )
          .map((product) => product.series)
          .filter(Boolean)
      ),
    ],
    [products, bulkRule.trigger_brand]
  );

  const freeSeries = useMemo(
    () => [
      ...new Set(
        products
          .filter(
            (product) =>
              !bulkRule.free_brand || product.brand === bulkRule.free_brand
          )
          .map((product) => product.series)
          .filter(Boolean)
      ),
    ],
    [products, bulkRule.free_brand]
  );

  const bulkRules = rules.filter(
    (rule) => rule.rule_kind === PROMOTION_RULE_KINDS.BULK_BUY_GET_FREE
  );

  const promotionRules = rules.filter(
    (rule) => rule.rule_kind === PROMOTION_RULE_KINDS.PROMOTION_PRICE
  );

  const reducedRules = rules.filter(
    (rule) => rule.rule_kind === PROMOTION_RULE_KINDS.REDUCED_PRICE
  );

  const loadData = async () => {
    setLoading(true);
    setError("");

    try {
      await ensureDefaultPromotionTypes();
      const [productRows, typeRows, ruleRows] = await Promise.all([
        getProducts(),
        getPromotionTypes(),
        getPromotionRules(),
      ]);

      setProducts((productRows || []).filter(isActiveProduct));
      setPromotionTypes(typeRows || []);
      setRules(ruleRows || []);
    } catch (loadError) {
      console.error("Promotions loading error:", loadError);
      setError(loadError.message || "Could not load promotions.");
    }

    setLoading(false);
  };

  useEffect(() => {
    loadData();
  }, []);

  const findTypeId = (typeName) =>
    promotionTypes.find((type) => type.type_name === typeName)?.id || "";

  const getBulkTypeId = () =>
    bulkRule.promotion_type_id || findTypeId("Buy More Get Free Product");

  const getPromotionTypeId = () =>
    promotionRule.promotion_type_id || findTypeId("Promotion Price");

  const getReducedTypeId = () =>
    reducedRule.promotion_type_id || findTypeId("Reduced Price");

  const applyBulkLabelToSeries = async () => {
    setSaving(true);
    setError("");
    setSuccess("");

    try {
      const productIds = products
        .filter(
          (product) =>
            product.brand === bulkRule.trigger_brand &&
            product.series === bulkRule.trigger_series
        )
        .map((product) => product.id)
        .filter(Boolean);

      await updateProductPromotionLabels(productIds, bulkRule.label_type);
      setSuccess("Label applied to selected buy series.");
      await loadData();
    } catch (labelError) {
      console.error("Promotion label saving error:", labelError);
      setError(labelError.message || "Could not apply label.");
    }

    setSaving(false);
  };

  const saveBulkRule = async () => {
    setSaving(true);
    setError("");
    setSuccess("");

    try {
  await savePromotionRule(
  {
    id: bulkRule.id || undefined,
    promotion_name: bulkRule.promotion_name,
    promotion_type_id: getBulkTypeId(),
    active: bulkRule.active,
    rule_kind: PROMOTION_RULE_KINDS.BULK_BUY_GET_FREE,

    trigger_brand: bulkRule.trigger_brand,
    trigger_series: bulkRule.trigger_series,
    buy_qty: bulkRule.buy_qty,

    free_brand: bulkRule.free_brand,
    free_series: bulkRule.free_series,
    free_qty: bulkRule.free_qty,

    label_type: bulkRule.label_type,
    start_date: bulkRule.start_date,
    end_date: bulkRule.end_date,
  },
  []
);

      setBulkRule(emptyBulkRule);
      setSuccess("Bulk buy promotion saved.");
      await loadData();
    } catch (saveError) {
      console.error("Bulk promotion saving error:", saveError);
      setError(saveError.message || "Could not save bulk promotion.");
    }

    setSaving(false);
  };

  const saveProductPromotion = async () => {
    setSaving(true);
    setError("");
    setSuccess("");

    try {
      await Promise.all(
        promotionRule.selectedProductIds.map((productId) =>
          savePromotionRule(
            {
              id:
                promotionRule.selectedProductIds.length === 1
                  ? promotionRule.id || undefined
                  : undefined,
              promotion_name: promotionRule.promotion_name,
              promotion_type_id: getPromotionTypeId(),
              active: promotionRule.active,
              rule_kind: PROMOTION_RULE_KINDS.PROMOTION_PRICE,
              trigger_product_id: productId,
              offer_price: promotionRule.offer_price,
              label_type: promotionRule.label_type,
              start_date: promotionRule.start_date,
              end_date: promotionRule.end_date,
            },
            [productId]
          )
        )
      );

      setPromotionRule(emptyPromotionRule);
      setPromotionSearch("");
      setSuccess("Promotion price saved.");
      await loadData();
    } catch (saveError) {
      console.error("Promotion price saving error:", saveError);
      setError(saveError.message || "Could not save promotion price.");
    }

    setSaving(false);
  };

  const saveReducedPromotion = async () => {
    setSaving(true);
    setError("");
    setSuccess("");

    try {
      await Promise.all(
        reducedRule.selectedProductIds.map((productId) =>
          savePromotionRule(
            {
              id:
                reducedRule.selectedProductIds.length === 1
                  ? reducedRule.id || undefined
                  : undefined,
              promotion_name: reducedRule.promotion_name,
              promotion_type_id: getReducedTypeId(),
              active: reducedRule.active,
              rule_kind: PROMOTION_RULE_KINDS.REDUCED_PRICE,
              trigger_product_id: productId,
              offer_price: reducedRule.offer_price,
              label_type: reducedRule.label_type || "reduced",
              start_date: reducedRule.start_date,
              end_date: reducedRule.end_date,
            },
            [productId]
          )
        )
      );

      setReducedRule(emptyReducedRule);
      setReducedSearch("");
      setSuccess("Reduced price saved.");
      await loadData();
    } catch (saveError) {
      console.error("Reduced price saving error:", saveError);
      setError(saveError.message || "Could not save reduced price.");
    }

    setSaving(false);
  };

  const saveType = async () => {
    setSaving(true);
    setError("");
    setSuccess("");

    try {
      if (typeForm.id) {
        await updatePromotionType(typeForm.id, {
          type_name: typeForm.type_name,
          active: typeForm.active,
        });
      } else {
        const savedType = await savePromotionType(typeForm.type_name);
        if (savedType && savedType.active !== typeForm.active) {
          await updatePromotionType(savedType.id, { active: typeForm.active });
        }
      }

      setTypeForm(emptyTypeForm);
      setSuccess("Promotion type saved.");
      await loadData();
    } catch (saveError) {
      console.error("Promotion type saving error:", saveError);
      setError(saveError.message || "Could not save promotion type.");
    }

    setSaving(false);
  };

  const editBulkRule = (rule) => {
    setBulkRule({
      ...emptyBulkRule,
      id: rule.id,
      promotion_name: rule.promotion_name || "",
      promotion_type_id: rule.promotion_type_id || "",
      active: rule.active !== false,
      trigger_brand: rule.trigger_brand || "",
      trigger_series: rule.trigger_series || "",
      free_brand: rule.free_brand || "",
      buy_qty: rule.buy_qty || 10,
      free_series: rule.free_series || "",
      free_qty: rule.free_qty || 1,
      start_date: rule.start_date || "",
      end_date: rule.end_date || "",
      label_type: rule.label_type || "",
      
    });
  };

  const editPriceRule = (rule, kind) => {
    const setter =
      kind === PROMOTION_RULE_KINDS.REDUCED_PRICE
        ? setReducedRule
        : setPromotionRule;

    setter({
      ...(kind === PROMOTION_RULE_KINDS.REDUCED_PRICE
        ? emptyReducedRule
        : emptyPromotionRule),
      id: rule.id,
      promotion_name: rule.promotion_name || "",
      promotion_type_id: rule.promotion_type_id || "",
      active: rule.active !== false,
      selectedProductIds: (rule.product_id || rule.trigger_product_id)
        ? [rule.product_id || rule.trigger_product_id]
        : [],
      offer_price: rule.promotion_price || rule.offer_price || "",
      label_type:
        rule.label_type ||
        (kind === PROMOTION_RULE_KINDS.REDUCED_PRICE ? "reduced" : "promotion"),
      start_date: rule.start_date || "",
      end_date: rule.end_date || "",
    });
  };

  return (
    <div className="w-full p-4 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Promotions</h1>
          <p className="text-sm text-slate-500">
            Manage bulk buy, promotion price and reduced price rules.
          </p>
        </div>
        <button
          type="button"
          onClick={loadData}
          className="bg-white border text-slate-800 rounded-xl px-4 py-2 font-bold hover:bg-slate-50"
        >
          Refresh
        </button>
      </div>

      <div className="bg-white border rounded-xl shadow-sm p-4 flex flex-wrap gap-2">
        {tabs.map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => setActiveTab(tab)}
            className={`rounded-xl px-4 py-2 font-bold ${
              activeTab === tab
                ? "bg-blue-600 text-white"
                : "text-slate-600 hover:bg-slate-100"
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      {loading && (
        <Card title="Loading">
          <div className="text-slate-600">Loading promotions...</div>
        </Card>
      )}

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-red-700 font-bold">
          {error}
        </div>
      )}

      {success && (
        <div className="bg-green-50 border border-green-200 rounded-xl p-4 text-green-700 font-bold">
          {success}
        </div>
      )}

      {!loading && activeTab === "Bulk Buy - Get Free" && (
        <div className="space-y-4">
          <Card title="Promotion Details">
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-3">
              <Field label="Promotion Name">
                <input
                  value={bulkRule.promotion_name}
                  onChange={(event) =>
                    setBulkRule({ ...bulkRule, promotion_name: event.target.value })
                  }
                  className="border border-slate-300 rounded-xl px-4 py-3 w-full text-slate-900"
                />
              </Field>
              <Field label="Promotion Type">
                <PromotionTypeSelect
                  value={getBulkTypeId()}
                  onChange={(promotion_type_id) =>
                    setBulkRule({ ...bulkRule, promotion_type_id })
                  }
                  promotionTypes={activePromotionTypes}
                />
              </Field>
              <Field label="Start Date">
                <input
                  type="date"
                  value={bulkRule.start_date}
                  onChange={(event) =>
                    setBulkRule({ ...bulkRule, start_date: event.target.value })
                  }
                  className="border border-slate-300 rounded-xl px-4 py-3 w-full text-slate-900"
                />
              </Field>
              <Field label="End Date">
                <input
                  type="date"
                  value={bulkRule.end_date}
                  onChange={(event) =>
                    setBulkRule({ ...bulkRule, end_date: event.target.value })
                  }
                  className="border border-slate-300 rounded-xl px-4 py-3 w-full text-slate-900"
                />
              </Field>
              <Field label="Status">
                <ActiveCheckbox
                  checked={bulkRule.active}
                  onChange={(active) => setBulkRule({ ...bulkRule, active })}
                />
              </Field>
            </div>
          </Card>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
            <Card title="Buy Rule">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <Field label="Buy Brand">
                  <select
                    value={bulkRule.trigger_brand}
                    onChange={(event) =>
                      setBulkRule({
                        ...bulkRule,
                        trigger_brand: event.target.value,
                        trigger_series: "",
                      })
                    }
                    className="border border-slate-300 rounded-xl px-4 py-3 w-full bg-white text-slate-900"
                  >
                    <option value="">Select Brand</option>
                    {brands.map((brand) => (
                      <option key={brand} value={brand}>
                        {brand}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Buy Series">
                  <select
                    value={bulkRule.trigger_series}
                    onChange={(event) =>
                      setBulkRule({ ...bulkRule, trigger_series: event.target.value })
                    }
                    className="border border-slate-300 rounded-xl px-4 py-3 w-full bg-white text-slate-900"
                  >
                    <option value="">Select Series</option>
                    {buySeries.map((series) => (
                      <option key={series} value={series}>
                        {series}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Buy Quantity">
                  <input
                    type="number"
                    min="1"
                    value={bulkRule.buy_qty}
                    onChange={(event) =>
                      setBulkRule({ ...bulkRule, buy_qty: event.target.value })
                    }
                    className="border border-slate-300 rounded-xl px-4 py-3 w-full text-slate-900"
                  />
                </Field>
              </div>
            </Card>

            <Card title="Free Rule">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <Field label="Free Brand">
                  <select
                    value={bulkRule.free_brand}
                    onChange={(event) =>
                      setBulkRule({
                        ...bulkRule,
                        free_brand: event.target.value,
                        free_series: "",
                      })
                    }
                    className="border border-slate-300 rounded-xl px-4 py-3 w-full bg-white text-slate-900"
                  >
                    <option value="">Select Brand</option>
                    {brands.map((brand) => (
                      <option key={brand} value={brand}>
                        {brand}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Free Series">
                  <select
                    value={bulkRule.free_series}
                    onChange={(event) =>
                      setBulkRule({ ...bulkRule, free_series: event.target.value })
                    }
                    className="border border-slate-300 rounded-xl px-4 py-3 w-full bg-white text-slate-900"
                  >
                    <option value="">Select Series</option>
                    {freeSeries.map((series) => (
                      <option key={series} value={series}>
                        {series}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Free Quantity">
                  <input
                    type="number"
                    min="1"
                    value={bulkRule.free_qty}
                    onChange={(event) =>
                      setBulkRule({ ...bulkRule, free_qty: event.target.value })
                    }
                    className="border border-slate-300 rounded-xl px-4 py-3 w-full text-slate-900"
                  />
                </Field>
              </div>
            </Card>
          </div>

          <Card title="Label">
            <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-3">
              <Field label="Label">
                <LabelSelector
                  value={bulkRule.label_type}
                  onChange={(label_type) =>
                    setBulkRule({ ...bulkRule, label_type })
                  }
                />
              </Field>
              <div className="flex items-end">
                <button
                  type="button"
                  onClick={applyBulkLabelToSeries}
                  disabled={
                    saving ||
                    !bulkRule.trigger_brand ||
                    !bulkRule.trigger_series
                  }
                  className="bg-blue-600 text-white rounded-xl px-4 py-2 font-bold hover:bg-blue-700 disabled:opacity-40"
                >
                  Apply label to selected buy series
                </button>
              </div>
            </div>
          </Card>

          <ActionButtons
            saving={saving}
            onSave={saveBulkRule}
            onClear={() => setBulkRule(emptyBulkRule)}
          />

          <Card title="Bulk Buy Promotions">
            <div className="overflow-x-auto border rounded-xl">
              <table className="w-full text-sm">
                <thead className="bg-slate-700 text-white">
                  <tr>
                    <th className="p-3 text-left">Promotion Name</th>
                    <th className="p-3 text-left">Promotion Type</th>
                    <th className="p-3 text-left">Start Date</th>
                    <th className="p-3 text-left">End Date</th>
                    <th className="p-3 text-left">Expiry Alert</th>
                    <th className="p-3 text-left">Active</th>
                    <th className="p-3 text-right">Edit</th>
                  </tr>
                </thead>
                <tbody>
                  {bulkRules.map((rule) => (
                    <tr key={rule.id} className="bg-white border-b">
                      <td className="p-3 font-bold">{rule.promotion_name}</td>
                      <td className="p-3">
                        {typeNameById(promotionTypes, rule.promotion_type_id)}
                      </td>
                      <td className="p-3">{rule.start_date || "-"}</td>
                      <td className="p-3">{rule.end_date || "-"}</td>
                      <td className="p-3">{expiryAlert(rule.end_date)}</td>
                      <td className="p-3">
                        <ActiveStatusPill active={rule.active} />
                      </td>
                      <td className="p-3 text-right">
                        <button
                          type="button"
                          onClick={() => editBulkRule(rule)}
                          className="bg-blue-600 text-white rounded-xl px-4 py-2 font-bold hover:bg-blue-700"
                        >
                          Edit
                        </button>
                      </td>
                    </tr>
                  ))}
                  {!bulkRules.length && (
                    <tr>
                      <td colSpan="7" className="p-4 text-center text-slate-500">
                        No bulk buy promotions saved.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}

      {!loading && activeTab === "Promotion Price" && (
        <div className="space-y-4">
          <Card title="Promotion Details">
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-3">
              <Field label="Promotion Name">
                <input
                  value={promotionRule.promotion_name}
                  onChange={(event) =>
                    setPromotionRule({
                      ...promotionRule,
                      promotion_name: event.target.value,
                    })
                  }
                  className="border border-slate-300 rounded-xl px-4 py-3 w-full text-slate-900"
                />
              </Field>
              <Field label="Promotion Type">
                <PromotionTypeSelect
                  value={getPromotionTypeId()}
                  onChange={(promotion_type_id) =>
                    setPromotionRule({ ...promotionRule, promotion_type_id })
                  }
                  promotionTypes={activePromotionTypes}
                />
              </Field>
              <Field label="Start Date">
                <input
                  type="date"
                  value={promotionRule.start_date}
                  onChange={(event) =>
                    setPromotionRule({
                      ...promotionRule,
                      start_date: event.target.value,
                    })
                  }
                  className="border border-slate-300 rounded-xl px-4 py-3 w-full text-slate-900"
                />
              </Field>
              <Field label="End Date">
                <input
                  type="date"
                  value={promotionRule.end_date}
                  onChange={(event) =>
                    setPromotionRule({
                      ...promotionRule,
                      end_date: event.target.value,
                    })
                  }
                  className="border border-slate-300 rounded-xl px-4 py-3 w-full text-slate-900"
                />
              </Field>
              <Field label="Status">
                <ActiveCheckbox
                  checked={promotionRule.active}
                  onChange={(active) =>
                    setPromotionRule({ ...promotionRule, active })
                  }
                />
              </Field>
            </div>
          </Card>

          <Card title="Product Selector">
            <div className="space-y-3">
              <ProductSelector
                products={products}
                selectedProductIds={promotionRule.selectedProductIds}
                onChange={(selectedProductIds) =>
                  setPromotionRule({ ...promotionRule, selectedProductIds })
                }
                search={promotionSearch}
                setSearch={setPromotionSearch}
              />
              <SelectedProductsList
                products={products}
                selectedProductIds={promotionRule.selectedProductIds}
              />
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <Field label="Original Price">
                  <input
                    readOnly
                    value={
                      promotionRule.selectedProductIds.length === 1
                        ? Number(
                            products.find(
                              (product) =>
                                product.id === promotionRule.selectedProductIds[0]
                            )?.vatPrice ||
                              products.find(
                                (product) =>
                                  product.id === promotionRule.selectedProductIds[0]
                              )?.cashPrice ||
                              0
                          ).toFixed(2)
                        : ""
                    }
                    className="border border-slate-300 rounded-xl px-4 py-3 w-full bg-slate-50 text-slate-900"
                  />
                </Field>
                <Field label="Promotion Price">
                  <input
                    type="number"
                    step="0.01"
                    value={promotionRule.offer_price}
                    onChange={(event) =>
                      setPromotionRule({
                        ...promotionRule,
                        offer_price: event.target.value,
                      })
                    }
                    className="border border-slate-300 rounded-xl px-4 py-3 w-full text-slate-900"
                  />
                </Field>
                <Field label="Label">
                  <LabelSelector
                    value={promotionRule.label_type}
                    onChange={(label_type) =>
                      setPromotionRule({ ...promotionRule, label_type })
                    }
                  />
                </Field>
              </div>
            </div>
          </Card>

          <ActionButtons
            saving={saving}
            onSave={saveProductPromotion}
            onClear={() => {
              setPromotionRule(emptyPromotionRule);
              setPromotionSearch("");
            }}
          />

          <Card title="Promotion Price Rules">
            <div className="overflow-x-auto border rounded-xl">
              <table className="w-full text-sm">
                <thead className="bg-slate-700 text-white">
                  <tr>
                    <th className="p-3 text-left">Promotion Name</th>
                    <th className="p-3 text-left">Promotion Type</th>
                    <th className="p-3 text-left">Date</th>
                    <th className="p-3 text-left">Expiry Alert</th>
                    <th className="p-3 text-left">Active</th>
                    <th className="p-3 text-right">Edit</th>
                  </tr>
                </thead>
                <tbody>
                  {promotionRules.map((rule) => (
                    <tr key={rule.id} className="bg-white border-b">
                      <td className="p-3 font-bold">{rule.promotion_name}</td>
                      <td className="p-3">
                        {typeNameById(promotionTypes, rule.promotion_type_id)}
                      </td>
                      <td className="p-3">{formatDateRange(rule)}</td>
                      <td className="p-3">{expiryAlert(rule.end_date)}</td>
                      <td className="p-3">
                        <ActiveStatusPill active={rule.active} />
                      </td>
                      <td className="p-3 text-right">
                        <button
                          type="button"
                          onClick={() =>
                            editPriceRule(rule, PROMOTION_RULE_KINDS.PROMOTION_PRICE)
                          }
                          className="bg-blue-600 text-white rounded-xl px-4 py-2 font-bold hover:bg-blue-700"
                        >
                          Edit
                        </button>
                      </td>
                    </tr>
                  ))}
                  {!promotionRules.length && (
                    <tr>
                      <td colSpan="6" className="p-4 text-center text-slate-500">
                        No promotion price rules saved.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}

      {!loading && activeTab === "Reduced Price" && (
        <div className="space-y-4">
          <Card title="Promotion Details">
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-3">
              <Field label="Promotion Name">
                <input
                  value={reducedRule.promotion_name}
                  onChange={(event) =>
                    setReducedRule({
                      ...reducedRule,
                      promotion_name: event.target.value,
                    })
                  }
                  className="border border-slate-300 rounded-xl px-4 py-3 w-full text-slate-900"
                />
              </Field>
              <Field label="Promotion Type">
                <PromotionTypeSelect
                  value={getReducedTypeId()}
                  onChange={(promotion_type_id) =>
                    setReducedRule({ ...reducedRule, promotion_type_id })
                  }
                  promotionTypes={activePromotionTypes}
                />
              </Field>
              <Field label="Start Date">
                <input
                  type="date"
                  value={reducedRule.start_date}
                  onChange={(event) =>
                    setReducedRule({ ...reducedRule, start_date: event.target.value })
                  }
                  className="border border-slate-300 rounded-xl px-4 py-3 w-full text-slate-900"
                />
              </Field>
              <Field label="End Date">
                <input
                  type="date"
                  value={reducedRule.end_date}
                  onChange={(event) =>
                    setReducedRule({ ...reducedRule, end_date: event.target.value })
                  }
                  className="border border-slate-300 rounded-xl px-4 py-3 w-full text-slate-900"
                />
              </Field>
              <Field label="Status">
                <ActiveCheckbox
                  checked={reducedRule.active}
                  onChange={(active) => setReducedRule({ ...reducedRule, active })}
                />
              </Field>
            </div>
          </Card>

          <Card title="Reduced Price">
            <div className="space-y-3">
              <ProductSelector
                products={products}
                selectedProductIds={reducedRule.selectedProductIds}
                onChange={(selectedProductIds) =>
                  setReducedRule({ ...reducedRule, selectedProductIds })
                }
                search={reducedSearch}
                setSearch={setReducedSearch}
              />
              <SelectedProductsList
                products={products}
                selectedProductIds={reducedRule.selectedProductIds}
              />
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <Field label="Original Price">
                  <input
                    readOnly
                    value={
                      reducedRule.selectedProductIds.length === 1
                        ? Number(
                            products.find(
                              (product) =>
                                product.id === reducedRule.selectedProductIds[0]
                            )?.vatPrice ||
                              products.find(
                                (product) =>
                                  product.id === reducedRule.selectedProductIds[0]
                              )?.cashPrice ||
                              0
                          ).toFixed(2)
                        : ""
                    }
                    className="border border-slate-300 rounded-xl px-4 py-3 w-full bg-slate-50 text-slate-900"
                  />
                </Field>
                <Field label="Reduced Price">
                  <input
                    type="number"
                    step="0.01"
                    value={reducedRule.offer_price}
                    onChange={(event) =>
                      setReducedRule({
                        ...reducedRule,
                        offer_price: event.target.value,
                      })
                    }
                    className="border border-slate-300 rounded-xl px-4 py-3 w-full text-slate-900"
                  />
                </Field>
                <Field label="Label">
                  <LabelSelector
                    value={reducedRule.label_type}
                    onChange={(label_type) =>
                      setReducedRule({ ...reducedRule, label_type })
                    }
                  />
                </Field>
              </div>
            </div>
          </Card>

          <ActionButtons
            saving={saving}
            onSave={saveReducedPromotion}
            onClear={() => {
              setReducedRule(emptyReducedRule);
              setReducedSearch("");
            }}
          />

          <Card title="Reduced Price Rules">
            <div className="overflow-x-auto border rounded-xl">
              <table className="w-full text-sm">
                <thead className="bg-slate-700 text-white">
                  <tr>
                    <th className="p-3 text-left">Promotion Name</th>
                    <th className="p-3 text-left">Promotion Type</th>
                    <th className="p-3 text-left">Date</th>
                    <th className="p-3 text-left">Expiry Alert</th>
                    <th className="p-3 text-left">Active</th>
                    <th className="p-3 text-right">Edit</th>
                  </tr>
                </thead>
                <tbody>
                  {reducedRules.map((rule) => (
                    <tr key={rule.id} className="bg-white border-b">
                      <td className="p-3 font-bold">{rule.promotion_name}</td>
                      <td className="p-3">
                        {typeNameById(promotionTypes, rule.promotion_type_id)}
                      </td>
                      <td className="p-3">{formatDateRange(rule)}</td>
                      <td className="p-3">{expiryAlert(rule.end_date)}</td>
                      <td className="p-3">
                        <ActiveStatusPill active={rule.active} />
                      </td>
                      <td className="p-3 text-right">
                        <button
                          type="button"
                          onClick={() =>
                            editPriceRule(rule, PROMOTION_RULE_KINDS.REDUCED_PRICE)
                          }
                          className="bg-blue-600 text-white rounded-xl px-4 py-2 font-bold hover:bg-blue-700"
                        >
                          Edit
                        </button>
                      </td>
                    </tr>
                  ))}
                  {!reducedRules.length && (
                    <tr>
                      <td colSpan="6" className="p-4 text-center text-slate-500">
                        No reduced price rules saved.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}

      {!loading && activeTab === "Settings" && (
        <div className="space-y-4">
          <Card title="Create Promotion Type">
            <div className="grid grid-cols-1 md:grid-cols-[1fr_auto_auto] gap-3">
              <Field label="Type Name">
                <input
                  value={typeForm.type_name}
                  onChange={(event) =>
                    setTypeForm({ ...typeForm, type_name: event.target.value })
                  }
                  className="border border-slate-300 rounded-xl px-4 py-3 w-full text-slate-900"
                />
              </Field>
              <Field label="Status">
                <ActiveCheckbox
                  checked={typeForm.active}
                  onChange={(active) => setTypeForm({ ...typeForm, active })}
                />
              </Field>
              <div className="flex items-end">
                <button
                  type="button"
                  onClick={saveType}
                  disabled={saving || !typeForm.type_name.trim()}
                  className="bg-green-600 text-white rounded-xl px-4 py-2 font-bold hover:bg-green-700 disabled:opacity-40"
                >
                  Save Type
                </button>
              </div>
            </div>
          </Card>

          <Card title="Promotion Types">
            <div className="overflow-x-auto border rounded-xl">
              <table className="w-full text-sm">
                <thead className="bg-slate-700 text-white">
                  <tr>
                    <th className="p-3 text-left">Type Name</th>
                    <th className="p-3 text-left">Active</th>
                    <th className="p-3 text-right">Edit</th>
                  </tr>
                </thead>
                <tbody>
                  {promotionTypes.map((type) => (
                    <tr key={type.id} className="bg-white border-b">
                      <td className="p-3 font-bold">{type.type_name}</td>
                      <td className="p-3">
                        <ActiveStatusPill active={type.active} />
                      </td>
                      <td className="p-3 text-right">
                        <button
                          type="button"
                          onClick={() =>
                            setTypeForm({
                              id: type.id,
                              type_name: type.type_name,
                              active: type.active !== false,
                            })
                          }
                          className="bg-blue-600 text-white rounded-xl px-4 py-2 font-bold hover:bg-blue-700"
                        >
                          Edit
                        </button>
                      </td>
                    </tr>
                  ))}
                  {!promotionTypes.length && (
                    <tr>
                      <td colSpan="3" className="p-4 text-center text-slate-500">
                        No promotion types saved.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
