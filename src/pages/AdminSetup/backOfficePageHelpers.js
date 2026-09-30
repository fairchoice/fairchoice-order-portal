const placeholderTitles = {
  salesReports: "Sales Reports",
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
