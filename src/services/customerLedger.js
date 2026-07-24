import {
  postPreviousBalanceCollection,
} from "./previousBalanceCollectionService";

export async function createPreviousBalancePayment({
  customerAccountId,
  customerBranchId,
  customerName,
  amount,
  paymentType,
  whoPaid,
  receivedBy,
  notes,
  currentUser,
  role,
  source,
  ownerPassword,
  paymentIntentId,
}) {
  const paymentAmount = Number(amount || 0);

  if (!customerAccountId) throw new Error("Customer is required");
  if (!paymentAmount || paymentAmount <= 0) throw new Error("Amount is required");
  if (!paymentType) throw new Error("Payment type is required");
  if (!paymentIntentId) throw new Error("A stable payment intent is required");

  return postPreviousBalanceCollection({
    customerAccountId,
    customerBranchId,
    amount: paymentAmount,
    paymentMethod: paymentType,
    payerName: whoPaid,
    collectorName:
      currentUser?.staff_name || currentUser?.name || receivedBy || currentUser?.username,
    collectorStaffId: currentUser?.staff_id || currentUser?.id || null,
    collectorRole: role || currentUser?.role,
    notes: [source ? `Original collection source: ${source}` : "", notes].filter(Boolean).join("\n"),
    ownerPassword,
    paymentIntentId,
  });
}
