const placeholderTitles = {
  profitPortal: "Profit Portal",
  productLineAnalysis: "Product Line Analysis",
  salesReports: "Sales Reports",
  outstandingCustomers: "Outstanding Customers",
  collectionsReport: "Collections Report",
  driverCollections: "Driver Collections",
  auditLog: "Audit Log",
  importExport: "Import / Export",
  backupTools: "Backup Tools",
};

export function getComingSoonTitle(page) {
  if (typeof page === "string" && page.startsWith("comingSoon:")) {
    return page.replace("comingSoon:", "");
  }

  return placeholderTitles[page] || null;
}
