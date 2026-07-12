import { useEffect, useMemo, useState } from "react";
import { formatCurrency } from "../../utils/currency";
import {
  loadCentralPaymentCustomers,
  loadReadOnlyCustomerCreditSnapshot,
} from "../../services/centralPaymentService";

const PAGE_SIZE = 20;

const getLoggedInUser = () =>
  JSON.parse