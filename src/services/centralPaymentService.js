import { supabase } from "./supabase";
import {
  allocatePaymentOldestFirst,
  applyAllocationsToInvoices,
  buildCustomerTransactionHistory,
  createPaymentIdempotencyKey,
} from "../utils/centralPaymentCalculations";

const deliveredStatuses = ["delivered", "confirmed", "delivery confirmed", "completed"];

const getActor = (user = {}) =>
  user.email || user.username || user.name || user.id || "unknown";

export async function