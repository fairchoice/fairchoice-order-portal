import { supabase } from "./supabase";
import {
  allocatePaymentOldestFirst,
  applyAllocationsToInvoices,
  buildCustomerTransactionHistory,
  createPaymentIdempotencyKey,
} from "../utils/centralPaymentCalculations";

const deliveredStatuses = ["delivered", "confirmed", "delivery confirmed", "completed"];

const getActor = (user = {}) =>