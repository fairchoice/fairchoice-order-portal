import { useEffect, useState } from "react";
import { supabase } from "../../services/supabase";
import { formatCurrency } from "../../utils/currency";
import { calculateDocumentTotals } from "../../utils/documentTotals";
import { sortPrintItems } from "../../utils/printItemSorting";
import { formatDisplayOrderId } from "../../utils/orderDisplay";
import { isOperationalCustomer } from "../../utils/customerStatus";
import {
  createOrUpdateInvoiceForDeliveredOrder,
  loadCustomerOutstandingSnapshot,
  printThermalReceipt,
  withResolvedInvoicePaymentStatus,
} from "../../services/centralInvoiceEngine";
import {
  loadCentralPaymentSnapshot,
  loadReadOnlyCustomerCreditSnapshot,
} from "../../services/centralPaymentService";
import {
  allocatePaymentOldestFirst,
  applyAllocationsToInvoices,
} from "../../utils/centralPaymentCalculations";
import { saveConfirmedServerManagerOrderToProcessingQueue } from "../../services/orders";
import {
  CANONICAL_PAYMENT_SOURCES,
  postCanonicalCustomerPayment,
  shouldCreateCanonicalDeliveryPayment,
} from "../../services/canonicalPaymentService";
import {
  createPreviousBalancePaymentIntentId,
  postPreviousBalanceCollection,
} from "../../services/previousBalanceCollectionService";
import ReturnRequestModal from "../../components/ReturnRequestModal";

const COMPLETED_COLLECTION_STORAGE_KEY =
  "fairchoice_driver_completed_collection_orders";

const loadCompletedCollectionOrderIds = () => {
  try {
    const saved = JSON.parse(
      localStorage.getItem(COMPLETED_COLLECTION_STORAGE_KEY) || "[]"
    );
    return new Set((Array.isArray(saved) ? saved : []).map(String));
  } catch {
    return new Set();
  }
};


export default function Driver({
  orders = [],
  changeOrderStatus = () => {},
  updateOrderExtraFields = () => {},
  refreshOrders = async () => {},
}) {
  const [expandedOrder, setExpandedOrder] = useState(null);
  const [selectedDriver, setSelectedDriver] = useState("All");
  const [cashCollectionOrder, setCashCollectionOrder] = useState(null);
  const [returnOrder, setReturnOrder] = useState(null);
  const [completedCollectionOrderIds, setCompletedCollectionOrderIds] = useState(loadCompletedCollectionOrderIds);
  const [selectedCreditCustomerId, setSelectedCreditCustomerId] = useState("");
  const [selectedCreditBranchId, setSelectedCreditBranchId] = useState("");

  const [creditCustomers, setCreditCustomers] = useState([]);


const [savingPayment, setSavingPayment] = useState(false);
const [savingPreviousBalance, setSavingPreviousBalance] = useState(false);
const [previousBalanceOutstanding, setPreviousBalanceOutstanding] = useState({
  totalOutstanding: 0,
  branchOutstanding: {},
});
const [cashCollectionOutstanding, setCashCollectionOutstanding] = useState({
  totalOutstanding: 0,
  selectedOutstanding: 0,
  branchOutstanding: {},
});

const loggedInUser = JSON.parse(
  localStorage.getItem("loggedInUser") || "{}"
);

const legacyTestTextValues = new Set(["nisstaj", "test", "test user", "test receiver"]);
const isLegacyTestText = (value) =>
  legacyTestTextValues.has(String(value || "").trim().toLowerCase());
const isLegacyTestAmount = (value) => Number(value || 0) === 500;
const cleanLegacyTestText = (value) => (isLegacyTestText(value) ? "" : value || "");
const cleanLegacyTestAmount = (value, order = {}) => {
  const hasLegacyName =
    isLegacyTestText(order.paidBy || order.paid_by) ||
    isLegacyTestText(order.receivedBy || order.received_by);
  return isLegacyTestAmount(value) && hasLegacyName ? "" : value || "";
};

  const getDriverTotals = (order) =>
    calculateDocumentTotals(order.items || [], order);

  const getDriverItems = (order) => sortPrintItems(getDriverTotals(order).invoiceItems);

  const [showPreviousBalance, setShowPreviousBalance] = useState(false);

  const [previousBalanceForm, setPreviousBalanceForm] = useState({
  amount: "",
  paymentType: "Cash",
  whoPaid: "",
  notes: "",
  paymentIntentId: createPreviousBalancePaymentIntentId(),
  });

  const printResolvedThermalReceipt = async (order) => {
    const resolvedOrder = await withResolvedInvoicePaymentStatus(order);
    printThermalReceipt(resolvedOrder);
  };
 
  const [paymentForm, setPaymentForm] = useState({
  paymentType: "Cash",
  collectionType: "TODAY_INVOICE",
  resolvedCollectionType: "",
  outstandingCollectionStatus: "",
  paymentAmount: "",
  paidBy: "",
});

const getCollectionOrderKey = (order = {}) =>
  String(order.orderId || order.order_number || order.id || "");

const markCollectionCompleted = (order = {}) => {
  const completedOrderKey = getCollectionOrderKey(order);
  if (!completedOrderKey) return;

  setCompletedCollectionOrderIds((currentIds) => {
    const nextIds = new Set(currentIds);
    nextIds.add(completedOrderKey);

    localStorage.setItem(
      COMPLETED_COLLECTION_STORAGE_KEY,
      JSON.stringify([...nextIds])
    );

    return nextIds;
  });

  setCashCollectionOrder(null);
};

useEffect(() => {
  refreshOrders();
}, []);

useEffect(() => {
  loadCreditCustomers();
}, []);

const loadCreditCustomers = async () => {
  const { data, error } = await supabase
    .from("customer_accounts")
    .select("id, account_name, status, active, customer_branches(*)")
    .eq("active", true)
    .or("status.is.null,status.ilike.Active")
    .order("account_name");

  if (error) {
    console.error(error);
    alert("Could not load customers.");
    return;
  }

  setCreditCustomers((data || []).filter(isOperationalCustomer));
};

const selectedCreditCustomer = creditCustomers.find(
  (customer) => String(customer.id) === String(selectedCreditCustomerId)
);

const selectedCreditBranches =
  selectedCreditCustomer?.customer_branches?.filter(
    (branch) => branch.active !== false
  ) || [];

const selectedCreditBranch = selectedCreditBranches.find(
  (branch) => String(branch.id) === String(selectedCreditBranchId)
);

useEffect(() => {
  let active = true;

  const loadOutstanding = async () => {
    if (!selectedCreditCustomer) {
      setPreviousBalanceOutstanding({ totalOutstanding: 0, branchOutstanding: {} });
      return;
    }

    try {
      const snapshot = await loadCustomerOutstandingSnapshot({
        customerAccountId: selectedCreditCustomer.id,
        customerName: selectedCreditCustomer.account_name,
      });

      if (active) setPreviousBalanceOutstanding(snapshot);
    } catch (error) {
      console.error("Driver outstanding load error:", error);
      if (active) {
        setPreviousBalanceOutstanding({ totalOutstanding: 0, branchOutstanding: {} });
      }
    }
  };

  loadOutstanding();

  return () => {
    active = false;
  };
}, [selectedCreditCustomer?.id]);

  const driverNames = [
    "All",
    ...new Set(
      orders
        .filter((order) =>
          ["Ready For Driver", "Delivered"].includes(order.status)
        )
        .map((order) => order.driverName || order.driver_name)
        .filter(Boolean)
    ),
  ];

      const driverOrders = orders.filter((order) => {
  const driverName = order.driverName || order.driver_name;

  const isReadyForDriver = order.status === "Ready For Driver";

  const isDeliveredWaitingPayment =
    order.status === "Delivered" &&
    !order.paymentType &&
    !order.payment_type &&
    order.paymentCollected !== "Yes" &&
    order.payment_collected !== "Yes" &&
    order.paymentCollected !== true &&
    order.payment_collected !== true;

  const matchesDriver =
    selectedDriver === "All" || driverName === selectedDriver;

  const collectionCompletedLocally = completedCollectionOrderIds.has(
    String(order.orderId || order.order_number || order.id || "")
  );

  return (
    (isReadyForDriver || isDeliveredWaitingPayment) &&
    matchesDriver &&
    !collectionCompletedLocally
  );
  });
const loadDriverCreditOutstanding = async ({
  customerAccountId,
  customerName,
  customerBranchId,
  branchName,
}) => {
  const creditSnapshot = await loadReadOnlyCustomerCreditSnapshot({
    customerAccountId,
    customerName,
    selectedBranchId: customerBranchId || "",
  });

  const branchOutstanding = {};

  (creditSnapshot.branchSummaries || []).forEach((branch) => {
    const outstanding = Number(branch.outstanding || 0);

    if (branch.branchId) {
      branchOutstanding[String(branch.branchId)] = outstanding;
    }

    if (branch.branchName) {
      branchOutstanding[String(branch.branchName)] = outstanding;
    }
  });

  const selectedBranchSummary =
    creditSnapshot.branchSummary ||
    (creditSnapshot.branchSummaries || []).find((branch) => {
      const idMatches =
        String(branch.branchId || "") === String(customerBranchId || "");

      const nameMatches =
        String(branch.branchName || "")
          .trim()
          .toLowerCase() ===
        String(branchName || "")
          .trim()
          .toLowerCase();

      return idMatches || nameMatches;
    });

  const totalOutstanding = Number(
    creditSnapshot.customerSummary?.outstanding || 0
  );

  const selectedOutstanding = Number(
    selectedBranchSummary?.outstanding ?? totalOutstanding
  );

  return {
    totalOutstanding,
    selectedOutstanding,
    branchOutstanding,
  };
};

const openCashCollection = async (order) => {
  setCashCollectionOrder(order.orderId);

  setCashCollectionOutstanding({
    totalOutstanding: 0,
    selectedOutstanding: 0,
    branchOutstanding: {},
  });

  const openingPaymentType =
    order.paymentType || order.payment_type || "Cash";

  const openingCollectionType =
    openingPaymentType === "Credit"
      ? "OUTSTANDING_PAYMENT"
      : order.collectionType ||
        order.collection_type ||
        order.paymentAppliesTo ||
        order.payment_applies_to ||
        "TODAY_INVOICE";

  setPaymentForm({
    paymentType: openingPaymentType,
    collectionType: openingCollectionType,
    resolvedCollectionType:
      order.resolvedCollectionType || order.resolved_collection_type || "",
    outstandingCollectionStatus:
      order.outstandingCollectionStatus ||
      order.outstanding_collection_status ||
      "",
    paymentAmount: cleanLegacyTestAmount(
      order.paymentAmount || order.payment_amount,
      order
    ),
    paidBy: cleanLegacyTestText(order.paidBy || order.paid_by),
  });

  try {
    const snapshot = await loadDriverCreditOutstanding({
      customerAccountId:
        order.customerAccountId || order.customer_account_id,
      customerName:
        order.companyName || order.company_name,
      customerBranchId:
        order.customerBranchId || order.customer_branch_id,
      branchName:
        order.branchName || order.branch_name,
    });

    setCashCollectionOutstanding(snapshot);
  } catch (error) {
    console.error("Cash collection outstanding load error:", error);

    setCashCollectionOutstanding({
      totalOutstanding: 0,
      selectedOutstanding: 0,
      branchOutstanding: {},
    });
  }
};

  const savePreviousBalancePayment = async () => {
  const paymentAmount = Number(previousBalanceForm.amount || 0);

  if (!selectedCreditCustomer) {
    alert("Please select customer.");
    return;
  }

  if (selectedCreditBranches.length > 0 && !selectedCreditBranch) {
    alert("Please select branch / shop.");
    return;
  }

  if (!paymentAmount || paymentAmount <= 0) {
    alert("Please enter amount.");
    return;
  }

  if (!previousBalanceForm.whoPaid.trim()) {
    alert("Please enter who paid.");
    return;
  }

  if (isLegacyTestText(previousBalanceForm.whoPaid)) {
    alert("Please replace the test payer name before saving.");
    return;
  }

  const selectedOutstanding = selectedCreditBranch
    ? Number(
        previousBalanceOutstanding.branchOutstanding[selectedCreditBranch.id] ??
          previousBalanceOutstanding.branchOutstanding[
            selectedCreditBranch.branch_name
          ] ??
          0
      )
    : Number(previousBalanceOutstanding.totalOutstanding || 0);

  if (
    selectedOutstanding > 0 &&
    paymentAmount > selectedOutstanding &&
    !window.confirm(
      "Payment is higher than selected branch outstanding. Continue?"
    )
  ) {
    return;
  }

  setSavingPreviousBalance(true);
  try {
    await postPreviousBalanceCollection({
      customerAccountId: selectedCreditCustomer.id,
      customerBranchId: selectedCreditBranch?.id || null,
      amount: paymentAmount,
      paymentMethod: previousBalanceForm.paymentType,
      paymentDate: new Date().toISOString(),
      payerName: previousBalanceForm.whoPaid,
      collectorName:
        loggedInUser.staff_name || loggedInUser.name || loggedInUser.username || "",
      collectorStaffId: loggedInUser.staff_id || loggedInUser.id || null,
      collectorRole: loggedInUser.role || loggedInUser.access_level || "",
      notes:
        previousBalanceForm.notes ||
        `Driver previous balance collection - ${previousBalanceForm.paymentType}`,
      paymentIntentId: previousBalanceForm.paymentIntentId,
    });
  } catch (error) {
    alert("Could not save previous balance payment: " + error.message);
    return;
  } finally {
    setSavingPreviousBalance(false);
  }

  alert("Previous Balance Payment saved successfully.");

  setPreviousBalanceForm({
    amount: "",
    paymentType: "Cash",
    whoPaid: "",
    notes: "",
    paymentIntentId: createPreviousBalancePaymentIntentId(),
  });

  setSelectedCreditCustomerId("");
  setSelectedCreditBranchId("");
  setShowPreviousBalance(false);
};

  const confirmDelivery = async (order, confirmedBy) => {
  try {
    await updateOrderExtraFields(order.orderId, {
      delivered_confirmed_by: confirmedBy,
    });

    const getInvoiceStatusClass = (status) => {
  if (status === "PAID") return "status-paid";
  if (status === "PART PAID") return "status-part-paid";
  return "status-unpaid";
  };

    await changeOrderStatus(order.orderId, "Delivered");

    await createOrUpdateInvoiceForDeliveredOrder({
      order,
      confirmedBy,
      currentUser: loggedInUser,
    });

    openCashCollection(order);
  } catch (error) {
    console.error("Delivery confirmation error:", error);
    alert("Could not confirm delivery: " + error.message);
  }
};

const moveBackToWarehouse = async (order) => {
  if (order.status === "Delivered") return;
  if (!window.confirm("Move this order back to Warehouse?")) return;

  await changeOrderStatus(order.orderId, "Warehouse Packing");
  await refreshOrders();
};

const printDeliveryNoteDocument = (order) => {
  const items = getDriverItems(order);
  const html = `
    <html>
      <head>
        <title>Delivery Note - ${order.orderId || order.order_number}</title>
        <style>
          body { font-family: Arial, sans-serif; padding: 24px; color: #111827; }
          h1 { margin: 0 0 12px; }
          table { width: 100%; border-collapse: collapse; margin-top: 18px; }
          th, td { border-bottom: 1px solid #ddd; padding: 8px; text-align: left; }
          th:last-child, td:last-child { text-align: right; }
        </style>
      </head>
      <body>
        <h1>Delivery Note</h1>
        <div><strong>Order Number:</strong> ${order.orderId || order.order_number || "-"}</div>
        <div><strong>Customer:</strong> ${order.companyName || order.company_name || "-"}</div>
        <div><strong>Date:</strong> ${order.createdAt || order.created_at || "-"}</div>
        <table>
          <thead><tr><th>Product</th><th>Qty</th></tr></thead>
          <tbody>
            ${items
              .map(
                (item) =>
                  `<tr><td>${item.name || item.productName || item.product_name || ""}</td><td>${item.pickedQty ?? item.qty ?? 0}</td></tr>`
              )
              .join("")}
          </tbody>
        </table>
        <script>window.print();</script>
      </body>
    </html>
  `;

  const win = window.open("", "_blank", "width=800,height=700");
  if (!win) {
    alert("Popup blocked. Please allow popups to print the delivery note.");
    return;
  }

  win.document.write(html);
  win.document.close();
};


const normalizeCollectionType = (value) => {
  const normalized = String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_");

  if (["OUTSTANDING_PAYMENT", "PREVIOUS_BALANCE", "PREVIOUS_CREDIT_BALANCE"].includes(normalized)) {
    return "OUTSTANDING_PAYMENT";
  }
  if (["PART_PAYMENT", "PARTIAL_PAYMENT"].includes(normalized)) {
    return "PART_PAYMENT";
  }
  if (["UNALLOCATED_PAYMENT", "UNKNOWN_PAYMENT"].includes(normalized)) {
    return "UNALLOCATED_PAYMENT";
  }
  return "TODAY_INVOICE";
};

const collectionTypeToAllocationMode = (collectionType, resolvedCollectionType = "") => {
  const effectiveType =
    normalizeCollectionType(collectionType) === "UNALLOCATED_PAYMENT"
      ? normalizeCollectionType(resolvedCollectionType)
      : normalizeCollectionType(collectionType);

  return effectiveType === "OUTSTANDING_PAYMENT"
    ? "PREVIOUS_BALANCE"
    : "TODAY_INVOICE";
};

const getInvoiceOrderKeys = (invoice = {}) =>
  [
    invoice.order_id,
    invoice.orderId,
    invoice.order_number,
    invoice.orderNumber,
    invoice.invoice_reference,
    invoice.invoice_number,
    invoice.reference_no,
    invoice.id,
  ]
    .map((value) => String(value || "").trim().toLowerCase())
    .filter(Boolean);

const buildDeliveryPaymentAllocations = ({
  invoices = [],
  allocations = [],
  amount = 0,
  branchId = "",
  order = {},
  mode = "TODAY_INVOICE",
} = {}) => {
  const availableInvoices = applyAllocationsToInvoices(invoices, allocations);
  const orderKeys = new Set(
    [order.id, order.orderId, order.order_number, order.orderNumber]
      .map((value) => String(value || "").trim().toLowerCase())
      .filter(Boolean)
  );

  const todayInvoices = availableInvoices.filter((invoice) =>
    getInvoiceOrderKeys(invoice).some((key) => orderKeys.has(key))
  );
  const previousInvoices = availableInvoices.filter(
    (invoice) => !todayInvoices.includes(invoice)
  );

  const allocateSequence = (groups) => {
    let remaining = Number(amount || 0);
    const combined = [];

    groups.forEach((group) => {
      if (remaining <= 0 || !group.length) return;
      const preview = allocatePaymentOldestFirst(group, remaining, { branchId });
      combined.push(...preview.allocations);
      remaining = Number(preview.unallocatedAmount || 0);
    });

    return { allocations: combined, unallocatedAmount: remaining };
  };

  switch (String(mode || "TODAY_INVOICE").toUpperCase()) {
    case "PREVIOUS_BALANCE":
      return allocateSequence([previousInvoices]);
    case "PREVIOUS_THEN_TODAY":
      return allocateSequence([previousInvoices, todayInvoices]);
    case "TODAY_THEN_PREVIOUS":
      return allocateSequence([todayInvoices, previousInvoices]);
    default:
      return allocateSequence([todayInvoices]);
  }
};

  const saveCashCollection = async (order) => {
    if (savingPayment) return;

    const collectionOrderKey = getCollectionOrderKey(order);

    if (completedCollectionOrderIds.has(collectionOrderKey)) {
      alert("This collection has already been saved. The order cannot be collected again.");
      setCashCollectionOrder(null);
      return;
    }

    const paymentType = String(paymentForm.paymentType || "Cash");
    const isCredit = paymentType === "Credit";
    const collectionType = isCredit
      ? "OUTSTANDING_PAYMENT"
      : normalizeCollectionType(paymentForm.collectionType);
    const resolvedCollectionType =
      collectionType === "UNALLOCATED_PAYMENT"
        ? normalizeCollectionType(paymentForm.resolvedCollectionType)
        : "";
    const effectiveCollectionType =
      collectionType === "UNALLOCATED_PAYMENT"
        ? resolvedCollectionType
        : collectionType;
    const creditCollectionStatus = String(
      paymentForm.outstandingCollectionStatus || ""
    ).toUpperCase();
    const creditPaymentCollected =
      isCredit && creditCollectionStatus === "COLLECTED";
    const paymentCollected = isCredit
      ? creditPaymentCollected
        ? "Yes"
        : "No"
      : "Yes";
    const paymentAmount = Number(paymentForm.paymentAmount || 0);
    const invoiceAmount = Number(getDriverTotals(order).grandTotal || 0);

    if (!paymentForm.paidBy.trim()) {
      alert("Please enter who paid / shop staff name.");
      return;
    }

    if (isLegacyTestText(paymentForm.paidBy)) {
      alert("Please replace the test payer name before saving.");
      return;
    }

    if (isCredit && !creditCollectionStatus) {
      alert("Please select Payment Collected or Payment Not Collected.");
      return;
    }

    if (collectionType === "UNALLOCATED_PAYMENT" && !paymentForm.resolvedCollectionType) {
      alert("Please choose how the unallocated payment should be resolved.");
      return;
    }

    if ((!isCredit || creditPaymentCollected) && paymentAmount <= 0) {
      alert("Please enter a payment amount greater than zero.");
      return;
    }

    setSavingPayment(true);
    try {
      const orderBranchKey =
        order.customerBranchId ||
        order.customer_branch_id ||
        order.branchName ||
        order.branch_name;
      const orderBranchOutstanding = Number(
        orderBranchKey
          ? cashCollectionOutstanding.selectedOutstanding ??
              cashCollectionOutstanding.totalOutstanding ??
              0
          : cashCollectionOutstanding.totalOutstanding ?? 0
      );

      const availableAccountCredit = Math.max(0, -orderBranchOutstanding);
      const payablePartPaymentInvoice = Math.max(
        0,
        invoiceAmount - availableAccountCredit
      );

      if (
        !isCredit &&
        effectiveCollectionType === "PART_PAYMENT" &&
        (payablePartPaymentInvoice <= 0 || paymentAmount >= payablePartPaymentInvoice)
      ) {
        alert(
          payablePartPaymentInvoice <= 0
            ? "Part payment is not available because the account credit fully covers today's invoice."
            : "Part payment must be less than today's invoice balance after account credit."
        );
        return;
      }

      if (
        !isCredit &&
        effectiveCollectionType === "OUTSTANDING_PAYMENT" &&
        orderBranchOutstanding > 0 &&
        paymentAmount > orderBranchOutstanding &&
        !window.confirm(
          "Payment is higher than the current outstanding balance. Continue?"
        )
      ) {
        return;
      }

      const collectorName =
        loggedInUser.staff_name ||
        loggedInUser.name ||
        loggedInUser.full_name ||
        loggedInUser.username ||
        "";

      const transactionReason = isCredit
        ? creditPaymentCollected
          ? "OUTSTANDING_COLLECTED_WITH_NEW_CREDIT_INVOICE"
          : "WEEKLY_CREDIT_NOT_COLLECTED"
        : effectiveCollectionType;

      const cashCollectionPayload = {
        payment_type: paymentType,
        payment_amount:
          isCredit && !creditPaymentCollected ? 0 : paymentAmount,
        payment_collected: paymentCollected,
        paid_by: paymentForm.paidBy.trim(),
        received_by: collectorName,
        collection_type: collectionType,
        resolved_collection_type: resolvedCollectionType || null,
        transaction_reason: transactionReason,
        payment_applies_to: isCredit
          ? "PREVIOUS_BALANCE"
          : collectionTypeToAllocationMode(
              collectionType,
              resolvedCollectionType
            ),
      };

      const shouldPostPayment =
        paymentAmount > 0 && (!isCredit || creditPaymentCollected);

      if (
        shouldPostPayment &&
        (isCredit ||
          shouldCreateCanonicalDeliveryPayment({
            paymentCollected,
            paymentType,
            amount: paymentAmount,
          }))
      ) {
        const customerAccountId =
          order.customerAccountId || order.customer_account_id || null;
        const customerBranchId =
          order.customerBranchId || order.customer_branch_id || null;
        const paymentReference =
          order.order_number || order.orderId || order.id || "";

        const snapshot = await loadCentralPaymentSnapshot({
          customerAccountId,
          customerName:
            order.companyName || order.company_name || "Unknown Customer",
          selectedBranchId: customerBranchId || "",
        });

        const allocationMode = isCredit
          ? "PREVIOUS_BALANCE"
          : collectionTypeToAllocationMode(
              collectionType,
              resolvedCollectionType
            );
        const allocationPreview = buildDeliveryPaymentAllocations({
          invoices: snapshot.invoices,
          allocations: snapshot.allocations,
          amount: paymentAmount,
          branchId: customerBranchId || "",
          order,
          mode: allocationMode,
        });

        await postCanonicalCustomerPayment({
          customerAccountId,
          customerBranchId,
          amount: paymentAmount,
          paymentDate: new Date().toISOString(),
          paymentMethod: paymentType,
          paymentSource: CANONICAL_PAYMENT_SOURCES.DRIVER_DELIVERY,
          paymentReference,
          paidBy: paymentForm.paidBy.trim(),
          collectorName,
          collectorStaffId: loggedInUser.staff_id || loggedInUser.id || null,
          collectorRole:
            loggedInUser.role || loggedInUser.access_level || "Driver",
          orderId: null,
          paymentIntentId: `delivery:${
            order.id || order.orderId || order.order_number
          }:${collectionType}:${paymentAmount}`,
          notes: `Delivery collection - ${paymentType} - ${transactionReason}`,
          metadata: {
            order_uuid: order.id || null,
            order_number: order.order_number || order.orderId || null,
            collection_type: collectionType,
            resolved_collection_type: resolvedCollectionType || null,
            outstanding_collection_status: isCredit
              ? creditCollectionStatus
              : null,
            transaction_reason: transactionReason,
            payment_applies_to: allocationMode,
            delivery_collection: true,
            collector_staff_name: collectorName,
            collector_username: loggedInUser.username || null,
            collector_staff_code: loggedInUser.staff_code || null,
          },
          allocations: allocationPreview.allocations,
        });

        // The canonical payment is now saved. Hide and lock this order
        // immediately so a later order-field update error cannot cause
        // the same collection to be entered again.
        markCollectionCompleted(order);
      }

      try {
        await updateOrderExtraFields(order.orderId, {
          payment_type: cashCollectionPayload.payment_type,
          payment_amount: cashCollectionPayload.payment_amount,
          payment_collected: cashCollectionPayload.payment_collected,
          paid_by: cashCollectionPayload.paid_by,
          received_by: cashCollectionPayload.received_by,
        });
      } catch (orderUpdateError) {
        console.error(
          "Payment saved, but order payment fields could not be updated:",
          orderUpdateError
        );
      }

      await saveConfirmedServerManagerOrderToProcessingQueue({
        orderNumber: order.orderId || order.order_number,
        confirmedAt:
          order.deliveredAt ||
          order.delivered_at ||
          order.delivery_confirmed_at ||
          order.confirmed_at ||
          new Date().toISOString(),
        fallbackOrder: {
          ...order,
          ...cashCollectionPayload,
          outstanding_collection_status: isCredit
            ? creditCollectionStatus
            : null,
          amount_not_collected:
            isCredit && !creditPaymentCollected ? invoiceAmount : 0,
          order_number: order.order_number || order.orderId,
          price_mode: order.price_mode || order.priceMode,
          order_items: order.order_items || order.items || [],
        },
      });

      // Credit-not-collected has no canonical payment, so mark it
      // completed after the weekly-credit queue entry is saved.
      if (!shouldPostPayment) {
        markCollectionCompleted(order);
      }

      alert(
        isCredit
          ? creditPaymentCollected
            ? "Outstanding payment saved first and today's invoice kept in Customer Credit."
            : "Today's invoice saved to weekly credit as amount not collected."
          : "Payment collection saved."
      );

      try {
        await refreshOrders();
      } catch (refreshError) {
        console.error("Orders could not be refreshed after collection:", refreshError);
      }
    } catch (error) {
      console.error("Cash collection error:", error);
      alert("Could not save collection: " + error.message);
    } finally {
      setSavingPayment(false);
    }
  };

  return (
    <div className="p-4">
      <div className="mb-4 text-center">
        <h2 className="text-2xl font-bold">Driver Portal</h2>
      </div>

      <div className="mb-4 flex justify-end">
  <button
   onClick={() => setShowPreviousBalance(!showPreviousBalance)}
    className="bg-slate-800 text-white px-4 py-2 rounded-xl text-sm font-bold"
  >
    Previous Balance
  </button>
</div>

                {showPreviousBalance && (
  <div className="mb-4 border rounded-2xl p-4 bg-slate-50 space-y-3">
    <h3 className="font-bold text-center">Previous Balance Collection</h3>

      <select
        value={selectedCreditCustomerId}
        onChange={(e) => setSelectedCreditCustomerId(e.target.value)}
        className="w-full border rounded-xl p-3 bg-white"
      >
        <option value="">Select Customer</option>

        {creditCustomers.map((customer) => (
          <option
            key={customer.id}
            value={customer.id}
          >
            {customer.account_name}
          </option>
        ))}
      </select>

      <select
  value={selectedCreditBranchId}
  onChange={(e) => setSelectedCreditBranchId(e.target.value)}
  className="w-full border rounded-xl p-3 bg-white"
  disabled={!selectedCreditCustomerId}
>
  <option value="">Select Branch / Shop</option>

  {selectedCreditBranches.map((branch) => (
    <option key={branch.id} value={branch.id}>
      {branch.branch_name}
      {branch.postcode ? ` - ${branch.postcode}` : ""}
    </option>
  ))}
  
</select>

{selectedCreditCustomer && (
  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
    <div className="border rounded-xl p-3 bg-white">
      <div className="text-xs font-bold text-slate-500">Customer outstanding</div>
      <div className="text-xl font-extrabold text-red-700">
        {formatCurrency(previousBalanceOutstanding.totalOutstanding || 0)}
      </div>
    </div>

    {selectedCreditBranch && (
      <div className="border rounded-xl p-3 bg-white">
        <div className="text-xs font-bold text-slate-500">
          Selected branch outstanding
        </div>
        <div className="text-xl font-extrabold text-red-700">
          {formatCurrency(
            previousBalanceOutstanding.branchOutstanding[selectedCreditBranch.id] ??
              previousBalanceOutstanding.branchOutstanding[
                selectedCreditBranch.branch_name
              ] ??
              0
          )}
        </div>
      </div>
    )}
  </div>
)}

    <input
      type="number"
      placeholder="Amount Collected"
      value={previousBalanceForm.amount}
      onChange={(e) =>
        setPreviousBalanceForm({
          ...previousBalanceForm,
          amount: e.target.value,
        })
      }
      className="w-full border rounded-xl p-3"
    />

    <select
      value={previousBalanceForm.paymentType}
      onChange={(e) =>
        setPreviousBalanceForm({
          ...previousBalanceForm,
          paymentType: e.target.value,
        })
      }
      className="w-full border rounded-xl p-3 bg-white"
    >
      <option value="Cash">Cash</option>
      <option value="Bank Transfer">Bank Transfer</option>
      <option value="Card">Card</option>
      <option value="Cheque">Cheque</option>
    </select>

    <input
      placeholder="Who paid / shop staff name"
      value={previousBalanceForm.whoPaid}
      onChange={(e) =>
        setPreviousBalanceForm({
          ...previousBalanceForm,
          whoPaid: e.target.value,
        })
      }
      className="w-full border rounded-xl p-3"
    />

    <textarea
      placeholder="Notes"
      value={previousBalanceForm.notes}
      onChange={(e) =>
        setPreviousBalanceForm({
          ...previousBalanceForm,
          notes: e.target.value,
        })
      }
      className="w-full border rounded-xl p-3"
    />

      <button
        type="button"
        onClick={savePreviousBalancePayment}
        disabled={savingPreviousBalance}
        className="w-full bg-green-700 text-white py-3 rounded-xl font-bold"
      >
        {savingPreviousBalance ? "Saving securely..." : "Save Previous Balance Payment"}
      </button>
          </div>
        )}

      <div className="mb-4">
        <label className="block text-xs font-bold text-slate-500 mb-1">
          Driver Filter
        </label>

        <select
          value={selectedDriver}
          onChange={(e) => setSelectedDriver(e.target.value)}
          className="w-full border rounded-xl px-3 py-3 text-sm font-bold bg-white"
        >
          {driverNames.map((driver) => (
            <option key={driver} value={driver}>
              {driver}
            </option>
          ))}
        </select>
      </div>

      {driverOrders.length === 0 && (
        <div className="border rounded-2xl p-4 text-sm text-center">
          No driver orders.
        </div>
      )}

      <div className="space-y-3">
        {driverOrders.map((order) => (
          <div key={order.orderId} className="bg-white border rounded-2xl p-3">
            <div className="flex flex-col gap-3">
              <div className="text-center">
                <h3 className="font-bold">
                  {formatDisplayOrderId(order.orderId || order.order_number)} |{" "}
                  {order.companyName || order.company_name || "No company"}
                  {(order.branchName || order.branch_name)
                    ? ` | ${order.branchName || order.branch_name}`
                    : ""}
                </h3>

                <div className="text-base font-extrabold text-red-600">
                  Order Value: {formatCurrency(getDriverTotals(order).grandTotal)}
                <p className="text-xs text-slate-500">
                  {order.createdAt || order.created_at || "-"} | Total Items: {getDriverItems(order).length}
                </p>
              </div>
              </div>

              <div className="flex flex-wrap justify-center gap-2">
                <button
                  onClick={() =>
                    setExpandedOrder(
                      expandedOrder === order.orderId ? null : order.orderId
                    )
                  }
                  className="bg-blue-600 text-white px-4 py-2 rounded-lg text-xs font-bold min-w-[105px]"
                >
                  {expandedOrder === order.orderId ? "Hide Order" : "View Order"}
                </button>

                <button
                  onClick={() => printResolvedThermalReceipt(order)}
                  className="bg-black text-white px-4 py-2 rounded-lg text-xs font-bold min-w-[145px]"
                >
                  Print Thermal Receipt
                </button>

                {order.status === "Ready For Driver" && (
                  <button
                    onClick={() => {
                    const confirmedBy = window.prompt(
                      "Who confirmed the order?"
                    );

                    if (!confirmedBy?.trim()) {
                      alert("Please enter who confirmed the order.");
                      return;
                    }

                    confirmDelivery(order, confirmedBy.trim());
                  }}
                    className="bg-green-600 text-white px-4 py-2 rounded-lg text-xs font-bold min-w-[105px]"
                  >
                    Delivered
                  </button>
                )}

                {order.status === "Ready For Driver" && (
                  <>
                    <button
                      onClick={() => moveBackToWarehouse(order)}
                      className="bg-slate-700 text-white px-4 py-2 rounded-lg text-xs font-bold min-w-[130px]"
                    >
                      Back To Warehouse
                    </button>
                  </>
                )}

                {order.status === "Delivered" &&
                    order.payment_collected !== "Yes" &&
                    order.payment_collected !== true && (
                  <button
                    onClick={() => openCashCollection(order)}
                    className="bg-yellow-500 text-white px-4 py-2 rounded-lg text-xs font-bold min-w-[105px]"
                  >
                    Cash Collection
                  </button>
                )}

                {order.status === "Delivered" && (
                  <button
                    onClick={() => setReturnOrder(order)}
                    className="bg-purple-700 text-white px-4 py-2 rounded-lg text-xs font-bold min-w-[105px]"
                  >
                    Return
                  </button>
                )}
              </div>
            </div>


            {expandedOrder === order.orderId && (
              <div className="mt-3 space-y-2">
                {getDriverItems(order).map((item) => (
                  <div
                    key={item.id}
                    className="flex justify-between border rounded-xl p-2 text-sm"
                  >
                    <span>{item.name}</span>
                    <strong>{item.pickedQty ?? item.qty}</strong>
                  </div>
                ))}
              </div>
            )}

            {cashCollectionOrder === order.orderId && (
              <div className="mt-4 border rounded-2xl p-3 bg-slate-50 space-y-3">
                <h4 className="font-bold text-center">Cash Collection</h4>

                <div className="grid grid-cols-1 gap-2">
                  <button
                    type="button"
                    onClick={() => printResolvedThermalReceipt(order)}
                    className="w-full bg-black text-white py-2 rounded-xl text-sm font-bold"
                  >
                    Print Thermal Receipt
                  </button>
                </div>

                {(() => {
                  const displayBranchKey =
                    order.customerBranchId ||
                    order.customer_branch_id ||
                    order.branchName ||
                    order.branch_name;

                  const displayOutstanding = Number(
                    displayBranchKey
                      ? cashCollectionOutstanding.selectedOutstanding ??
                          cashCollectionOutstanding.totalOutstanding ??
                          0
                      : cashCollectionOutstanding.totalOutstanding ?? 0
                  );

                  return (
                    <div className="border rounded-xl p-3 bg-white">
                      <div className="text-xs font-bold text-slate-500">
                        {displayBranchKey ? "Branch outstanding" : "Customer outstanding"}
                      </div>
                      <div className="text-xl font-extrabold text-red-700">
                        {formatCurrency(Math.abs(displayOutstanding))}
                      </div>
                    </div>
                  );
                })()}

                {(() => {
  const invoiceAmount = Number(
    getDriverTotals(order).grandTotal || 0
  );

  const branchKey =
    order.customerBranchId ||
    order.customer_branch_id ||
    order.branchName ||
    order.branch_name;

  const currentOutstanding = Number(
    branchKey
      ? cashCollectionOutstanding.selectedOutstanding ??
          cashCollectionOutstanding.totalOutstanding ??
          0
      : cashCollectionOutstanding.totalOutstanding ?? 0
  );

  /*
   * Positive outstanding means money is owed.
   * Negative outstanding means the customer has account credit.
   *
   * The Customer Credit snapshot already includes today's delivered invoice,
   * so do not add today's invoice a second time here.
   */
  const outstandingDebt = Math.max(0, currentOutstanding);
  const availableAccountCredit = Math.max(0, -currentOutstanding);

  const accountBalanceIncludingToday = Math.abs(currentOutstanding);

  const collectionType = normalizeCollectionType(
    paymentForm.collectionType
  );

  const effectiveCollectionType =
    collectionType === "UNALLOCATED_PAYMENT"
      ? normalizeCollectionType(
          paymentForm.resolvedCollectionType
        )
      : collectionType;

  const isCredit =
    paymentForm.paymentType === "Credit";

  const creditCollectionStatus = String(
    paymentForm.outstandingCollectionStatus || ""
  ).toUpperCase();

  const creditPaymentCollected =
    isCredit &&
    creditCollectionStatus === "COLLECTED";

  const amountIsFixed =
    !isCredit &&
    effectiveCollectionType === "TODAY_INVOICE";

  const enteredAmount = Number(
    paymentForm.paymentAmount || 0
  );

  /*
   * Part Payment calculation:
   *
   * Existing return/account credit is deducted from
   * today's invoice before calculating the remaining
   * invoice amount.
   */
  const creditAppliedToPartPayment = isCredit
    ? 0
    : availableAccountCredit;

  const payablePartPaymentInvoice = Math.max(
    0,
    invoiceAmount - creditAppliedToPartPayment
  );

  const remainingToday = Math.max(
    0,
    payablePartPaymentInvoice - enteredAmount
  );

  /*
   * Remaining balance after the entered collection.
   * The starting figure is the current Customer Credit balance,
   * which already includes today's invoice.
   */
  const remainingAccountCredit = Math.max(
    0,
    accountBalanceIncludingToday - enteredAmount
  );

  const partPaymentAvailable =
    payablePartPaymentInvoice > 0;

  const canSave =
    Boolean(paymentForm.paidBy.trim()) &&
    (
      isCredit
        ? Boolean(creditCollectionStatus) &&
          (
            !creditPaymentCollected ||
            enteredAmount > 0
          )
        : enteredAmount > 0
    ) &&
    (
      isCredit ||
      collectionType !== "UNALLOCATED_PAYMENT" ||
      Boolean(paymentForm.resolvedCollectionType)
    ) &&
    (
      isCredit ||
      effectiveCollectionType !== "PART_PAYMENT" ||
      (
        partPaymentAvailable &&
        enteredAmount > 0 &&
        enteredAmount < payablePartPaymentInvoice
      )
    );

  return (
    <>
      <label className="text-xs font-bold uppercase text-slate-500">
        Payment Type
      </label>

      <select
        value={paymentForm.paymentType}
        onChange={(e) => {
          const paymentType = e.target.value;
          const isNextCredit =
            paymentType === "Credit";

          const nextCollectionType = isNextCredit
            ? "OUTSTANDING_PAYMENT"
            : paymentForm.collectionType;

          setPaymentForm({
            ...paymentForm,
            paymentType,
            collectionType: nextCollectionType,
            resolvedCollectionType: isNextCredit
              ? ""
              : paymentForm.resolvedCollectionType,
            outstandingCollectionStatus: "",
            paymentAmount:
              !isNextCredit &&
              nextCollectionType === "TODAY_INVOICE"
                ? String(invoiceAmount)
                : "",
          });
        }}
        className="w-full border rounded-xl p-3 font-bold bg-white"
      >
        <option value="Cash">Cash</option>
        <option value="Bank Transfer">
          Bank Transfer
        </option>
        <option value="Card">Card</option>
        <option value="Credit">Credit</option>
      </select>

      {!isCredit && (
        <>
          <label className="text-xs font-bold uppercase text-slate-500">
            Collection Type
          </label>

          <select
            value={paymentForm.collectionType}
            onChange={(e) => {
              const nextType = e.target.value;

              setPaymentForm({
                ...paymentForm,
                collectionType: nextType,
                resolvedCollectionType: "",
                paymentAmount:
                  nextType === "TODAY_INVOICE"
                    ? String(invoiceAmount)
                    : "",
              });
            }}
            className="w-full border rounded-xl p-3 bg-white"
          >
            <option value="TODAY_INVOICE">
              Today's Invoice
            </option>

            <option value="OUTSTANDING_PAYMENT">
              Outstanding Payment
            </option>

            <option
              value="PART_PAYMENT"
              disabled={!partPaymentAvailable}
            >
              Part Payment
            </option>

            <option value="UNALLOCATED_PAYMENT">
              Unallocated Payment
            </option>
          </select>
        </>
      )}

      {isCredit && (
        <>
          <label className="text-xs font-bold uppercase text-slate-500">
            Outstanding Collection
          </label>

          <select
            value={
              paymentForm.outstandingCollectionStatus
            }
            onChange={(e) =>
              setPaymentForm({
                ...paymentForm,
                outstandingCollectionStatus:
                  e.target.value,
                paymentAmount: "",
              })
            }
            className="w-full border rounded-xl p-3 bg-white"
          >
            <option value="">
              Select collection status
            </option>

            <option value="COLLECTED">
              Payment Collected
            </option>

            <option value="NOT_COLLECTED">
              Payment Not Collected
            </option>
          </select>
        </>
      )}

      {!isCredit &&
        collectionType === "UNALLOCATED_PAYMENT" && (
          <>
            <label className="text-xs font-bold uppercase text-slate-500">
              Resolve As
            </label>

            <select
              value={
                paymentForm.resolvedCollectionType
              }
              onChange={(e) => {
                const resolvedType = e.target.value;

                setPaymentForm({
                  ...paymentForm,
                  resolvedCollectionType:
                    resolvedType,
                  paymentAmount:
                    resolvedType ===
                    "TODAY_INVOICE"
                      ? String(invoiceAmount)
                      : "",
                });
              }}
              className="w-full border rounded-xl p-3 bg-white"
            >
              <option value="">
                Select correction
              </option>

              <option value="TODAY_INVOICE">
                Today's Invoice Error
              </option>

              <option value="OUTSTANDING_PAYMENT">
                Outstanding Payment Error
              </option>

              <option
                value="PART_PAYMENT"
                disabled={!partPaymentAvailable}
              >
                Part Payment Error
              </option>
            </select>
          </>
        )}

      <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
        <div className="border rounded-xl p-3 bg-white">
          <div className="text-xs font-bold text-slate-500">
            Today's invoice
          </div>

          <div className="text-lg font-extrabold text-slate-900">
            {formatCurrency(invoiceAmount)}
          </div>
        </div>

        <div className="border rounded-xl p-3 bg-white">
          <div className="text-xs font-bold text-slate-500">
            Account balance including today's invoice
          </div>

          <div className="text-lg font-extrabold text-red-700">
            {formatCurrency(
              accountBalanceIncludingToday
            )}
          </div>
        </div>
      </div>

      {(!isCredit || creditPaymentCollected) && (
        <>
          <label className="text-xs font-bold uppercase text-slate-500">
            Amount Collected
          </label>

          <input
            type="number"
            min="0"
            step="0.01"
            placeholder="Amount Collected"
            value={paymentForm.paymentAmount}
            readOnly={amountIsFixed}
            onChange={(e) =>
              setPaymentForm({
                ...paymentForm,
                paymentAmount: e.target.value,
              })
            }
            className={`w-full border rounded-xl p-3 ${
              amountIsFixed
                ? "bg-slate-100 font-bold text-slate-600"
                : "bg-white"
            }`}
          />
        </>
      )}

      {!isCredit &&
        effectiveCollectionType ===
          "PART_PAYMENT" && (
          <div className="border rounded-xl p-3 bg-amber-50">
            <div className="text-xs font-bold text-amber-700">
              Today's invoice balance after return
              and payment
            </div>

            <div className="text-xl font-extrabold text-amber-900">
              {formatCurrency(remainingToday)}
            </div>
          </div>
        )}

      {!isCredit &&
        effectiveCollectionType ===
          "OUTSTANDING_PAYMENT" &&
        availableAccountCredit > 0 && (
          <div className="border rounded-xl p-3 bg-blue-50">
            <div className="text-xs font-bold text-blue-700">
              Remaining return / account credit
              after amount collected
            </div>

            <div className="text-xl font-extrabold text-blue-900">
              {formatCurrency(
                remainingAccountCredit
              )}
            </div>
          </div>
        )}

      {isCredit &&
        creditCollectionStatus === "COLLECTED" && (
          <div className="rounded-xl border border-indigo-200 bg-indigo-50 p-3 text-sm font-semibold text-indigo-800">
            The collected amount is recorded
            against the previous outstanding
            balance first. Today's invoice remains
            in Customer Credit after it.
          </div>
        )}

      {isCredit &&
        creditCollectionStatus ===
          "NOT_COLLECTED" && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm font-semibold text-amber-800">
            No payment is recorded. Today's invoice
            is added to the weekly credit account as
            Amount Not Collected.
          </div>
        )}

      <label className="text-xs font-bold uppercase text-slate-500">
        Who Paid / Shop Staff Name
      </label>

      <input
        placeholder="Who paid / shop staff name"
        value={paymentForm.paidBy}
        onChange={(e) =>
          setPaymentForm({
            ...paymentForm,
            paidBy: e.target.value,
          })
        }
        className="w-full border rounded-xl p-3"
      />

      <div className="rounded-xl border bg-white p-3 text-xs font-semibold text-slate-600">
        Collected/processed by:{" "}
        {loggedInUser.staff_name ||
          loggedInUser.name ||
          loggedInUser.full_name ||
          loggedInUser.username ||
          "Logged-in staff"}
      </div>

      <button
        disabled={savingPayment || !canSave}
        onClick={() => saveCashCollection(order)}
        className="w-full bg-green-700 text-white py-3 rounded-xl font-bold disabled:bg-slate-400 disabled:cursor-not-allowed"
      >
        {savingPayment
          ? "Saving..."
          : isCredit
          ? creditPaymentCollected
            ? "Save Payment and Credit Invoice"
            : "Save Weekly Credit Not Collected"
          : "Save Payment"}
      </button>
    </>
  );
})()}
              </div>             
            )}
          </div>
        ))}
      </div>

      {returnOrder && (
        <ReturnRequestModal
          order={returnOrder}
          source="DELIVERY_PORTAL"
          currentUser={loggedInUser}
          onClose={() => setReturnOrder(null)}
          onSaved={refreshOrders}
        />
      )}
    </div>
  );
}