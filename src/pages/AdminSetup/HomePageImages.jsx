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

const getRequestedTab = () => {
  if (typeof window === "undefined") return "cards";
  const queryTab = new URLSearchParams(window.location.search).get("tab");
  return window.location.hash.toLowerCase() === "#home-content-notices" ||
    String(queryTab || "").toLowerCase() === "notices"
    ? "notices"
    : "cards";
};

const newClientId = () =>
  globalThis.crypto?.randomUUID?.() ||
  `homepage-item-${Date.now()}-${Math.random().toString(36).slice(2)}`;

const newHomepageItem = () => ({
  id: null,
  isDraft: true,
  clientId: newClientId(),
  title: "",
  description: "",
  subDescription: "",
  image: "",
  categoryType: "main_category",
  targetValue: "",
  sortOrder: 0,
  active: true,
});

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
        className="grid grid-cols-1 gap-2 sm:grid-cols-2"
        role="tablist"
        aria-label="Home page content sections"
      >
        {[
          { id: "cards", label: "Home Page Cards" },
          { id: "notices", label: "Customer Product Notices" },
        ].map((tab) => {
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
                  ? "min-h-14 rounded-2xl border border-blue-950 bg-blue-950 px-5 py-3 text-base font-extrabold text-white shadow-sm"
                  : "min-h-14 rounded-2xl border-2 border-slate-300 bg-white px-5 py-3 text-base font-extrabold text-slate-900 shadow-sm hover:border-blue-400"
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

      {!loading && activeTab === "cards" && (
        <div
          id="home-content-cards-panel"
          role="tabpanel"
          aria-labelledby="home-content-cards-tab"
          className="space-y-4"
        >
          <div className="flex flex-col gap-3 rounded-2xl border bg-slate-50 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h3 className="text-xl font-extrabold text-slate-900">
                Home Page Cards
              </h3>
              <p className="mt-1 text-sm text-slate-600">
                Edit navigation targets, images and ordering. Images must be
                JPG, PNG or WEBP and no larger than 5 MB.
              </p>
            </div>
            <button
              type="button"
              onClick={() =>
                setDrafts((current) => [...current, newHomepageItem()])
              }
              className="min-h-11 w-full rounded-xl bg-blue-700 px-4 py-2 text-sm font-bold text-white sm:w-auto"
            >
              Add New Home Item
            </button>
          </div>

          {itemsError && (
            <div
              role="alert"
              className="rounded-2xl border border-red-200 bg-red-50 p-5 font-bold text-red-800"
            >
              {itemsError}
            </div>
          )}

          {[...drafts, ...items].map((item) => (
            <HomePageContentItemEditor
              key={item.id || item.clientId}
              item={item}
              targetOptions={targetOptions}
              onSaved={async () => {
                if (item.isDraft) {
                  setDrafts((current) =>
                    current.filter(
                      (draft) => draft.clientId !== item.clientId
                    )
                  );
                }
                await loadItems();
              }}
              onDelete={deleteItem}
            />
          ))}
          {items.length === 0 && drafts.length === 0 && !itemsError && (
            <div className="rounded-2xl border border-dashed bg-white p-5 text-slate-600">
              No home items are configured.
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
