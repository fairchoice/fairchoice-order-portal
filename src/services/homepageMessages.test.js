import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  getMatchingHomepageMessages,
  isHomepageMessageActive,
  normalizeHomepageMessage,
} from "./homepageMessages.js";

test("homepage messages normalize database fields", () => {
  assert.deepEqual(
    normalizeHomepageMessage({
      id: "message-1",
      target_type: "brand",
      target_value: "Fair Choice",
      message: "Brand notice",
      message_style: "success",
      start_date: "2026-07-01",
      end_date: "2026-07-31",
      sort_order: 4,
      active: true,
    }),
    {
      id: "message-1",
      targetType: "brand",
      targetValue: "Fair Choice",
      message: "Brand notice",
      messageStyle: "success",
      startDate: "2026-07-01",
      endDate: "2026-07-31",
      sortOrder: 4,
      active: true,
    }
  );
});

test("homepage message date range is inclusive and inactive rows stay hidden", () => {
  const message = {
    active: true,
    startDate: "2026-07-10",
    endDate: "2026-07-20",
  };

  assert.equal(isHomepageMessageActive(message, new Date(2026, 6, 10, 12)), true);
  assert.equal(isHomepageMessageActive(message, new Date(2026, 6, 20, 12)), true);
  assert.equal(isHomepageMessageActive(message, new Date(2026, 6, 9, 12)), false);
  assert.equal(isHomepageMessageActive(message, new Date(2026, 6, 21, 12)), false);
  assert.equal(
    isHomepageMessageActive({ ...message, active: false }, new Date(2026, 6, 15)),
    false
  );
});

test("matching messages follow category, subcategory, brand and product selections", () => {
  const messages = [
    {
      id: "brand",
      targetType: "brand",
      targetValue: "Acme",
      message: "Brand",
      sortOrder: 3,
    },
    {
      id: "main",
      targetType: "main_category",
      targetValue: "Drinks",
      message: "Main",
      sortOrder: 1,
    },
    {
      id: "sub",
      targetType: "sub_category",
      targetValue: "Water",
      message: "Sub",
      sortOrder: 2,
    },
    {
      id: "other",
      targetType: "brand",
      targetValue: "Other",
      message: "Other",
      sortOrder: 0,
    },
    {
      id: "product",
      targetType: "product",
      targetValue: "product-123",
      message: "Product",
      sortOrder: 4,
    },
  ];

  const result = getMatchingHomepageMessages(messages, {
    selectedCategory: "drinks",
    selectedSubCategory: "WATER",
    selectedBrand: "Acme",
    selectedProductId: "product-123",
    now: new Date(2026, 6, 15),
  });

  assert.deepEqual(
    result.map((message) => message.id),
    ["main", "sub", "brand", "product"]
  );
});

test("homepage content architecture includes editor controls, navigation and SQL", () => {
  const read = (relativePath) =>
    fs.readFileSync(new URL(relativePath, import.meta.url), "utf8");
  const editor = read("../components/HomePageContentItemEditor.jsx");
  const grid = read("../components/HomeCategoryGrid.jsx");
  const customerOrder = read("../pages/CustomerOrder.jsx");
  const adminPage = read("../pages/AdminSetup/HomePageImages.jsx");
  const noticeEditor = read("../components/HomepageMessagesEditor.jsx");
  const noticeBanner = read("../components/HomepageTargetMessages.jsx");
  const sql = read("../../supabase/homepage-content.sql");

  for (const label of [
    "Title",
    "Description",
    "Target type",
    "Sort order",
    "Save Changes",
    "Delete Item",
    "Download Current Image",
  ]) {
    assert.match(editor, new RegExp(label));
  }
  assert.doesNotMatch(grid, /Great Prices|Wide Range|Fast Delivery|Trusted by Shops/);
  assert.match(customerOrder, /categoryType === "brand"/);
  assert.match(customerOrder, /categoryType === "custom_link"/);
  assert.match(customerOrder, /getMatchingHomepageMessages/);
  assert.match(customerOrder, /selectedProductNotices/);
  assert.match(adminPage, /Home Page Cards/);
  assert.match(adminPage, /Customer Product Notices/);
  assert.match(adminPage, /home-content-notices/);
  assert.match(noticeEditor, /\+ Publish New Notice/);
  assert.match(noticeEditor, /Publish Notice/);
  assert.match(noticeEditor, /Update Notice/);
  assert.match(noticeEditor, /Search by product name or code/);
  assert.match(noticeEditor, /Notice published successfully/);
  for (const bannerContract of [
    "Important Price Notice",
    "Customer Information",
    "Good News",
    "Important Customer Alert",
    "border-amber-400 bg-amber-50 text-amber-950",
    "border-blue-400 bg-blue-50 text-blue-950",
    "border-green-400 bg-green-50 text-green-950",
    "border-red-400 bg-red-50 text-red-950",
    "rounded-2xl border-2 p-4 shadow-md sm:p-5",
    'role="alert"',
    'aria-live="polite"',
    "space-y-3",
  ]) {
    assert.ok(
      noticeBanner.includes(bannerContract),
      `missing prominent notice banner contract: ${bannerContract}`
    );
  }

  for (const requiredSql of [
    "create table if not exists public.homepage_messages",
    "sub_description text",
    "'main_category'",
    "'sub_category'",
    "'brand'",
    "'product'",
    "'custom_link'",
    "homepage_messages_style_check",
    "set_homepage_content_updated_at",
    "enable row level security",
  ]) {
    assert.ok(sql.includes(requiredSql), `missing SQL contract: ${requiredSql}`);
  }
});
