import { supabase } from "./supabase";

export async function createPreviousBalancePayment({
  customerAccountId,
  customerName,
  amount,
  paymentType,
  whoPaid,
  receivedBy,
  notes,
  currentUser,
  role,
  source,
}) {
  const paymentAmount = Number(amount || 0);

  if (!customerAccountId) throw new Error("Customer is required");
  if (!paymentAmount || paymentAmount <= 0) throw new Error("Amount is required");
  if (!paymentType) throw new Error("Payment type is required");

  const { data, error } = await supabase
    .from("customer_ledger")
    .insert([
      {
        customer_account_id: customerAccountId,
        customer_name: customerName || null,

        transaction_type: "PAYMENT",
        description: "Previous Balance Payment",

        debit: 0,
        credit: paymentAmount,
        amount: paymentAmount,

        payment_type: paymentType,
        payment_applies_to: "PREVIOUS_BALANCE",

        collected_by: currentUser?.id || null,
        collected_by_name: currentUser?.name || receivedBy || null,
        collected_by_role: role,

        collection_source: source,

        who_paid: whoPaid || null,
        received_by: receivedBy || currentUser?.name || null,
        notes: notes || null,
      },
    ])
    .select()
    .single();

  if (error) throw error;

  return data;
}