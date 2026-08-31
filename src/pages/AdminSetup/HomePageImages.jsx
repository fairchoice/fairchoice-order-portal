import { useEffect, useState } from "react";

import HomePageContentItemEditor from "../../components/HomePageContentItemEditor";
import HomepageMessagesEditor from "../../components/HomepageMessagesEditor";
import {
  deleteHomepageItem,
  getAllHomepageItems,
  getHomepageTargetOptions,
} from "../../services/homepageItems";
import { getAllHomepageMessages } from "../../services/homepageMessages";
import { hasPermission } from "../../utils/permissions";

const emptyOptions = {
  mainCategories: [],
  subCategories: [],
  brands: [],
  products: [],
};

const HOME_TABS = [
  { id: "cards", label: "Home Page Cards" },
  { id: "promotion", label: "Top Promotion" },
  { id: "deals", label: "Deal / Advertisement" },
  { id: "notices", label: "Customer Product Notices" },
];

const getRequestedTab = () => {
  if (typeof window === "undefined") return "cards";
  const queryTab = String(new URLSearchParams(window.location.search).get("tab") || "").toLowerCase();
  const hashTab = String(window.location.hash || "").toLowerCase().replace("#home-content-", "");
  const requested = HOME_TABS.find((tab) => tab.id === queryTab || tab.id === hashTab);
  return requested?.id || "cards";
};

const newClientId = () =>
  globalThis.crypto?.randomUUID?.() ||
  `homepage-item-${Date.now()}-${Math.random().toString(36).slice(2)}`;

const newHomepageItem = (section = "cards") => ({
  id: null,
  isDraft: true,
  clientId: newClientId(),
  title: section === "promotion" ? "Top Promotion" : section === "deals" ? "Deal of the Day" : "",
  description: "",
  subDescription: "",
  image: "",
  categoryType: section === "promotion" || section === "deals" ? "promotion" : "main_category",
  targetValue: "",
  sortOrder: section === "promotion" ? -100 : section === "deals" ? 100 : 0,
  active: true,
});

const getSectionItems = (items, section) => {
  const promotionItems = (items || []).filter((item) => item.categoryType === "promotion");
  if (section === "promotion") return promotionItems.filter((item) => Number(item.sortOrder) < 0);
  if (section === "deals") return promotionItems.filter((item) => Number(item.sortOrder) >= 0).slice(0, 1);
  if (section === "cards") {
    return (items || []).filter((item) => !["promotion", "brand"].includes(item.categoryType));
  }
  return [];
};

export default function HomePageImages({ currentUser }) {
  const [activeTab, setActiveTab] = useState(getRequestedTab);
  const [items, setItems] = useState([]);
  const [drafts, setDrafts] = useState([]);
  const [messages, setMessages] = useState([]);
  const [targetOptions, setTargetOptions] = useState(emptyOptions);
  const [loading, setLoading] = useState(true);
  const [itemsError, setItemsError] = useState("");
  const [messagesError, setMessagesError] = useState("");
  const allowed = hasPermission(currentUser, "access_product_setup");

  const loadItems = async () => {
    try {
      setItems(await getAllHomepageItems());
      setItemsError("");
    } catch (error) {
      console.error("Homepage content loading failed:", error);
      setItemsError("Home page items could not be loaded.");
    }
  };

  const loadMessages = async () => {
    try {
      setMessages(await getAllHomepageMessages());
      setMessagesError("");
    } catch (error) {
      console.error("Homepage messages loading failed:", error);
      setMessagesError(
        "Category and brand messages could not be loaded. Run the supplied homepage-content SQL if this table is not installed."
      );
    }
  };

  useEffect(() => {
    if (!allowed) return undefined;
    let current = true;
    const loadInitialContent = async () => {
      const [itemsResult, messagesResult, optionsResult] =
        await Promise.allSettled([
          getAllHomepageItems(),
          getAllHomepageMessages(),
          getHomepageTargetOptions(),
        ]);
      if (!current) return;

      if (itemsResult.status === "fulfilled") setItems(itemsResult.value);
      else setItemsError("Home page items could not be loaded.");

      if (messagesResult.status === "fulfilled") {
        setMessages(messagesResult.value);
      } else {
        setMessagesError(
          "Category and brand messages could not be loaded. Run the supplied homepage-content SQL if this table is not installed."
        );
      }

      if (optionsResult.status === "fulfilled") {
        setTargetOptions(optionsResult.value);
      } else {
        setItemsError(
          "Home page target choices could not be loaded from categories or products."
        );
      }
      setLoading(false);
    };
    loadInitialContent();
    return () => {
      current = false;
    };
  }, [allowed]);

  useEffect(() => {
    const syncRequestedTab = () => setActiveTab(getRequestedTab());
    window.addEventListener("hashchange", syncRequestedTab);
    return () => window.removeEventListener("hashchange", syncRequestedTab);
  }, []);

  const deleteItem = async (item) => {
    if (
      !window.confirm(
        item.isDraft
          ? "Discard this unsaved home item?"
          : `Delete “${item.title || item.description || "this home item"}”?`
      )
    ) {
      return;
    }
    if (item.isDraft) {
      setDrafts((current) =>
        current.filter((draft) => draft.clientId !== item.clientId)
      );
      return;
    }
    try {
      await deleteHomepageItem(item.id);
      await loadItems();
    } catch (error) {
      setItemsError(error.message || "Home item could not be deleted.");
    }
  };

  if (!allowed) {
    return (
      <div className="rounded-2xl border border-red-200 bg-red-50 p-5 font-bold text-red-800">
        You do not have permission to manage home page content.
      </div>
    );
  }

  return (
    <section className="space-y-6">
      <div>
        <h2 className="text-2xl font-extrabold text-slate-900">
          Home Page Content
        </h2>
        <p className="mt-1 max-w-3xl text-sm text-slate-600">
          Manage customer home cards and targeted product notices.
        </p>
      </div>

      <div
        className="grid grid-cols-2 gap-2 md:grid-cols-4"
        role="tablist"
        aria-label="Home page content sections"
      >
        {HOME_TABS.map((tab) => {
          const selected = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              id={`home-content-${tab.id}-tab`}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-controls={`home-content-${tab.id}-panel`}
              onClick={() => setActiveTab(tab.id)}
              className={
                selected
                  ? "min-h-14 rounded-2xl border-2 border-orange-400 bg-[#172b63] px-4 py-3 text-sm font-extrabold text-white shadow-sm ring-2 ring-orange-100 sm:text-base"
                  : "min-h-14 rounded-2xl border-2 border-slate-300 bg-white px-4 py-3 text-sm font-extrabold text-slate-900 shadow-sm hover:border-orange-300 hover:bg-orange-50 sm:text-base"
              }
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {loading && (
        <div role="status" className="rounded-2xl border bg-white p-5">
          Loading home page content…
        </div>
      )}

      {!loading && ["cards", "promotion", "deals"].includes(activeTab) && (
        <div
          id={`home-content-${activeTab}-panel`}
          role="tabpanel"
          aria-labelledby={`home-content-${activeTab}-tab`}
          className="space-y-4"
        >
          <div className="flex flex-col gap-3 rounded-2xl border bg-slate-50 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h3 className="text-xl font-extrabold text-slate-900">
                {activeTab === "cards" && "Home Page Cards"}
                {activeTab === "promotion" && "Top Promotion"}
                {activeTab === "deals" && "Deal / Advertisement"}
              </h3>
              <p className="mt-1 text-sm text-slate-600">
                {activeTab === "cards" && "Manage the main category cards shown on the customer homepage."}
                {activeTab === "promotion" && "Add multiple top promotions. They appear as a compact horizontal promotion carousel at the top of the homepage."}
                {activeTab === "deals" && "Use one promotion or advertisement here. Its own title is shown on the customer homepage."}
              </p>
            </div>
            {!(activeTab === "deals" && (getSectionItems(items, "deals").length > 0 || drafts.some((draft) => draft.categoryType === "promotion" && Number(draft.sortOrder) >= 0))) && (
              <button
                type="button"
                onClick={() => setDrafts((current) => {
                  const draft = newHomepageItem(activeTab);
                  if (activeTab === "promotion") {
                    const existingTopCount = getSectionItems(items, "promotion").length;
                    const draftTopCount = current.filter((entry) => entry.categoryType === "promotion" && Number(entry.sortOrder) < 0).length;
                    draft.sortOrder = -100 + existingTopCount + draftTopCount;
                  }
                  return [...current, draft];
                })}
                className="min-h-11 w-full rounded-xl bg-blue-700 px-4 py-2 text-sm font-bold text-white sm:w-auto"
              >
                {activeTab === "cards" ? "Add New Home Item" : activeTab === "promotion" ? "Add Top Promotion" : activeTab === "deals" ? "Add Advertisement" : "Add Home Item"}
              </button>
            )}
          </div>

          {itemsError && (
            <div role="alert" className="rounded-2xl border border-red-200 bg-red-50 p-5 font-bold text-red-800">
              {itemsError}
            </div>
          )}

          {[...drafts.filter((draft) => {
            if (activeTab === "promotion") return draft.categoryType === "promotion" && Number(draft.sortOrder) < 0;
            if (activeTab === "deals") return draft.categoryType === "promotion" && Number(draft.sortOrder) >= 0;
            return !["promotion", "brand"].includes(draft.categoryType);
          }), ...getSectionItems(items, activeTab)].map((item) => (
            <HomePageContentItemEditor
              key={item.id || item.clientId}
              item={item}
              targetOptions={targetOptions}
              onSaved={async () => {
                if (item.isDraft) {
                  setDrafts((current) => current.filter((draft) => draft.clientId !== item.clientId));
                }
                await loadItems();
              }}
              onDelete={deleteItem}
              displayMode={activeTab === "promotion" ? "hero" : activeTab === "deals" ? "deal" : "standard"}
            />
          ))}

          {getSectionItems(items, activeTab).length === 0 && drafts.length === 0 && !itemsError && (
            <div className="rounded-2xl border border-dashed bg-white p-5 text-slate-600">
              No items are configured for this section yet.
            </div>
          )}
        </div>
      )}

      {!loading && activeTab === "notices" && (
        <div
          id="home-content-notices-panel"
          role="tabpanel"
          aria-labelledby="home-content-notices-tab"
          className="space-y-4"
        >
          {messagesError && (
            <div
              role="alert"
              className="rounded-2xl border border-amber-200 bg-amber-50 p-4 font-bold text-amber-900"
            >
              {messagesError}
            </div>
          )}
          <HomepageMessagesEditor
            messages={messages}
            options={targetOptions}
            onReload={loadMessages}
          />
        </div>
      )}
    </section>
  );
}
