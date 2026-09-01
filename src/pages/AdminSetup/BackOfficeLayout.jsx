import { useEffect, useMemo, useState } from "react";
import {
  PAGE_ACCESS_SECTIONS,
  canAccessPage as registryCanAccessPage,
  normalizeRole,
} from "../../security/accessControlRegistry";

const defaultOpenSections = {
  Operations: true,
  "Admin Setup": true,
};

const navSections = PAGE_ACCESS_SECTIONS;

const internalPagePermissions = Object.freeze({
  picking: "page.operations.received_orders",
  receivedOrders: "page.operations.received_orders",
  stockhistory: "page.product.stock_taking",
  stockreceipts: "page.product.import",
  security: "page.login.access_control",
  loginSetup: "page.login.access_control",
});

function canSeeItem(user, item) {
  if (item.key && !registryCanAccessPage(user, item.key)) return false;
  if (!item.children?.length) return true;
  return item.children.some((child) => canSeeItem(user, child));
}

function filterItemsByPermission(user, items = []) {
  return items
    .map((item) => {
      if (item.children?.length) {
        const children = filterItemsByPermission(user, item.children);
        return { ...item, children };
      }
      return item;
    })
    .filter((item) => canSeeItem(user, item));
}

function filterSectionsByPermission(user) {
  return navSections
    .map((section) => ({ ...section, items: filterItemsByPermission(user, section.items) }))
    .filter((section) => section.items.length > 0);
}

function canAccessBackOfficePage(user, page) {
  const role = normalizeRole(user?.role || user?.access_level);
  if (role === "Customer") return page === "customerPortal";
  if (role === "Brand Partner") return ["order", "brandPerformance"].includes(page);
  return registryCanAccessPage(user, internalPagePermissions[page] || page);
}

function hasActivePage(items = [], page) {
  return items.some((item) => {
    if (item.page === page) return true;
    return hasActivePage(item.children, page);
  });
}

function isItemActive(item, page) {
  if (item.page && item.page === page) return true;
  return hasActivePage(item.children, page);
}

function MenuItem({ item, page, depth = 0, onNavigate }) {
  const active = isItemActive(item, page);
  const hasChildren = Boolean(item.children?.length);
  const [open, setOpen] = useState(active);

  useEffect(() => {
    if (active) setOpen(true);
  }, [active]);

  const visible = open;

  if (hasChildren) {
    return (
      <div className="bo-nav-branch">
        <button type="button" className={`bo-tree-toggle bo-nav-parent ${active ? "is-active-parent" : ""}`} onClick={() => setOpen((value) => !value)} aria-expanded={visible} style={{ paddingLeft: `${12 + depth * 14}px` }}>
          <span>{item.label}</span><span className="bo-chevron">{visible ? "-" : "+"}</span>
        </button>
        {visible && <div className="bo-nav-children">{item.children.map((child) => <MenuItem key={`${item.label}-${child.label}`} item={child} page={page} depth={depth + 1} onNavigate={onNavigate} />)}</div>}
      </div>
    );
  }

  return <button type="button" className={`bo-nav-item ${active ? "is-active" : ""}`} style={{ paddingLeft: `${16 + depth * 14}px` }} onClick={() => onNavigate(item)}>{item.label}</button>;
}

function NavSection({ section, page, onNavigate }) {
  const active = hasActivePage(section.items, page);
  const [open, setOpen] = useState(Boolean(defaultOpenSections[section.title]) || active);

  useEffect(() => {
    if (active) setOpen(true);
  }, [active]);

  const visible = open;

  return (
    <section className="bo-nav-group">
      <button type="button" className={`bo-section-toggle ${active ? "is-active-section" : ""}`} onClick={() => setOpen((value) => !value)} aria-expanded={visible}>
        <span>{section.title}</span><span className="bo-chevron">{visible ? "-" : "+"}</span>
      </button>
      {visible && <div className="bo-section-items">{section.items.map((item) => <MenuItem key={`${section.title}-${item.label}`} item={item} page={page} onNavigate={onNavigate} />)}</div>}
    </section>
  );
}

export function ComingSoonPlaceholder({ title = "Coming Soon" }) {
  return <div className="bo-placeholder"><h2>{title}</h2><p>Coming soon</p></div>;
}

export default function BackOfficeLayout({ page, setPage, fetchOrders, currentUser, children, isAdmin, isSalesRep, isWarehouse, isDriver, isCustomer, onLogout }) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const allowedSections = useMemo(() => {
    const role = normalizeRole(currentUser?.role || currentUser?.access_level);
    const sections = filterSectionsByPermission(currentUser);
    if (role === "Brand Partner") {
      return sections.map((section) => {
        if (section.title === "Order") return { ...section, items: section.items.filter((item) => item.key === "page.order.sales_rep") };
        if (section.title === "Reports") return { ...section, items: section.items.filter((item) => item.key === "page.reports.brand_performance") };
        return { ...section, items: [] };
      }).filter((section) => section.items.length > 0);
    }
    if (!isWarehouse || isAdmin) return sections;
    return sections.map((section) => {
      if (section.title === "Operations") return section;
      if (section.title === "Accounts") return { ...section, items: section.items.filter((item) => item.key === "page.accounts.expenses") };
      return { ...section, items: [] };
    }).filter((section) => section.items.length > 0);
  }, [currentUser, isWarehouse, isAdmin]);
  const pageAllowed = canAccessBackOfficePage(currentUser, page);

  const roleLabel = useMemo(() => {
    const role = normalizeRole(currentUser?.role || currentUser?.access_level);
    if (role === "Brand Partner") return "Brand Partner - Read Only";
    if (isAdmin) return "Admin";
    if (isSalesRep) return "Sales Rep";
    if (isWarehouse) return "Warehouse";
    if (isDriver) return "Driver";
    if (isCustomer) return "Customer";
    return "Back Office";
  }, [currentUser, isAdmin, isSalesRep, isWarehouse, isDriver, isCustomer]);

  const handleNavigate = async (item) => {
    if (item.key && !registryCanAccessPage(currentUser, item.key)) { alert("You do not have permission to access this page."); return; }
    if (item.fetchOrdersBefore && typeof fetchOrders === "function") await fetchOrders();
    if (item.hash) window.history.replaceState(null, "", item.hash);
    setPage(item.page); setDrawerOpen(false);
    if (item.fetchOrdersAfter && typeof fetchOrders === "function") await fetchOrders();
  };

  const sidebar = <aside className="bo-sidebar" aria-label="Back Office navigation"><div className="bo-brand"><div className="bo-brand-mark">FC</div><div><div className="bo-brand-title">FairChoice</div><div className="bo-brand-subtitle">Order Portal</div></div></div>{onLogout && <button type="button" className="bo-logout bo-logout-top" onClick={onLogout}>Logout</button>}<nav className="bo-nav">{allowedSections.map((section) => <NavSection key={section.title} section={section} page={page} onNavigate={handleNavigate} />)}</nav><div className="bo-sidebar-footer"><div className="bo-role">{roleLabel}</div></div></aside>;

  return <div className="bo-shell"><style>{styles}</style><div className="bo-desktop-sidebar">{sidebar}</div>{drawerOpen && <button type="button" className="bo-scrim" aria-label="Close navigation" onClick={() => setDrawerOpen(false)} />}<div className={`bo-mobile-drawer ${drawerOpen ? "is-open" : ""}`}>{sidebar}</div><div className="bo-main"><header className="bo-header"><button type="button" className="bo-menu-button" aria-label="Open navigation" onClick={() => setDrawerOpen(true)}>Menu</button><div className="bo-header-text"><h1>FairChoice Order Portal</h1><p>Back Office</p></div></header><main className="bo-content">{pageAllowed ? children : <div className="bo-placeholder"><h2>Access denied</h2><p>You do not have permission to access this page.</p></div>}</main></div></div>;
}

const styles = `
.bo-shell { min-height: 100vh; width: 100%; display: flex; align-items: stretch; background: #f1f5f9; color: #102033; }
.bo-desktop-sidebar { flex: 0 0 260px; width: 260px; flex-shrink: 0; min-height: 100vh; }
.bo-sidebar { width: 260px; height: 100vh; position: sticky; top: 0; z-index: 30; display: flex; flex-direction: column; background: linear-gradient(180deg, #073763 0%, #092642 100%); color: #fff; overflow-y: auto; }
.bo-brand { display: flex; gap: 12px; align-items: center; padding: 18px 16px; border-bottom: 1px solid rgba(255, 255, 255, 0.12); }
.bo-brand-mark { width: 42px; height: 42px; border-radius: 12px; display: grid; place-items: center; background: #fff; color: #073763; font-weight: 800; }
.bo-brand-title { font-size: 18px; font-weight: 800; line-height: 1.1; }
.bo-brand-subtitle { font-size: 13px; color: rgba(255, 255, 255, 0.76); }
.bo-nav { flex: 1; padding: 12px; overflow-y: auto; }
.bo-nav-group { margin-bottom: 8px; }
.bo-section-toggle,.bo-tree-toggle,.bo-nav-item { width: 100%; border: 0; display: flex; align-items: center; justify-content: space-between; font: inherit; text-align: left; cursor: pointer; }
.bo-section-toggle { min-height: 42px; padding: 0 10px; border-radius: 10px; background: rgba(255, 255, 255, 0.07); color: #fff; font-size: 12px; font-weight: 800; letter-spacing: 0.08em; text-transform: uppercase; }
.bo-section-toggle:hover,.bo-section-toggle:focus-visible,.bo-tree-toggle:hover,.bo-tree-toggle:focus-visible,.bo-nav-item:hover,.bo-nav-item:focus-visible { background: rgba(255, 255, 255, 0.12); outline: none; }
.bo-section-toggle.is-active-section { background: rgba(255, 255, 255, 0.16); }
.bo-section-items { padding: 6px 0 4px; }
.bo-tree-toggle { min-height: 40px; margin: 2px 0; border-radius: 10px; background: transparent; color: rgba(255, 255, 255, 0.82); font-size: 14px; font-weight: 700; }
.bo-tree-toggle.is-active-parent { color: #fff; background: rgba(255, 255, 255, 0.1); }
.bo-nav-item { min-height: 40px; margin: 2px 0; border-radius: 10px; background: transparent; color: rgba(255, 255, 255, 0.88); font-size: 14px; }
.bo-nav-item.is-active { background: #fff; color: #073763; font-weight: 800; box-shadow: 0 8px 24px rgba(0, 0, 0, 0.16); }
.bo-chevron { flex: 0 0 auto; font-size: 18px; line-height: 1; margin-left: 10px; }
.bo-nav-children { margin-left: 12px; padding-left: 4px; border-left: 1px solid rgba(255, 255, 255, 0.14); }
.bo-sidebar-footer { padding: 14px; border-top: 1px solid rgba(255, 255, 255, 0.12); }
.bo-role { margin-bottom: 10px; color: rgba(255, 255, 255, 0.72); font-size: 13px; }
.bo-logout { width: 100%; min-height: 42px; border: 1px solid rgba(255, 255, 255, 0.28); border-radius: 10px; background: rgba(255, 255,255,0.08); color: #fff; font-weight: 700; cursor: pointer; }
.bo-main { min-width: 0; width: auto; flex: 1 1 auto; margin-left: 0; display: flex; flex-direction: column; background: #f1f5f9; }
.bo-header { min-height: 72px; display: flex; align-items: center; gap: 14px; padding: 14px 24px; background: #fff; border-bottom: 1px solid #dfe7f1; }
.bo-header h1 { margin: 0; font-size: 21px; line-height: 1.2; }.bo-header p { margin: 2px 0 0; color: #65758a; font-size: 14px; }
.bo-menu-button { display: none; min-width: 54px; height: 44px; border: 1px solid #cfdae8; border-radius: 10px; background: #fff; color: #073763; font-size: 14px; font-weight: 800; cursor: pointer; }
.bo-content { width: 100%; max-width: none; padding: 16px; overflow-x: auto; flex: 1; }
.bo-placeholder { padding: 20px; border-radius: 12px; background: #fff; border: 1px solid #dfe7f1; }.bo-placeholder h2 { margin: 0 0 8px; font-size: 22px; }.bo-placeholder p { margin: 0; color: #65758a; }
.bo-mobile-drawer,.bo-scrim { display: none; }
@media (max-width: 900px) { .bo-desktop-sidebar { display:none; }.bo-main { width:100%; }.bo-menu-button { display:inline-grid; place-items:center; flex:0 0 auto; }.bo-header { padding:12px 16px; }.bo-header h1 { font-size:18px; }.bo-content { padding:14px; }.bo-scrim { display:block; position:fixed; inset:0; z-index:40; border:0; background:rgba(4,16,31,.48); }.bo-mobile-drawer { display:block; position:fixed; inset:0 auto 0 0; z-index:50; width:min(88vw,340px); transform:translateX(-105%); transition:transform 180ms ease; }.bo-mobile-drawer.is-open { transform:translateX(0); }.bo-mobile-drawer .bo-sidebar { width:100%; position:static; }.bo-section-toggle,.bo-tree-toggle,.bo-nav-item { min-height:46px; } }
`;
