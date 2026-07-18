import { useEffect, useMemo, useState } from "react";
import { formatCurrency } from "../../utils/currency";
import {
  bulkArchiveFinancialTransactions,
  listGlobalFinancialHistory,
  permanentlyDeleteFinancialArchive,
  restoreFinancialTransaction,
} from "../../services/globalFinancialLedgerService";

const paymentMethods = ["Cash", "Card", "Bank Transfer", "Cheque", "Other"];
const transactionTypes = ["PAYMENT",