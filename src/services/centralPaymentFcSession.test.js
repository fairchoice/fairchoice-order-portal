import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const appSource = fs.readFileSync(new URL("../App.jsx", import.meta.url), "utf8");
const loginSource = fs.readFileSync(
  new URL("../pages/AdminSetup/LoginPage.jsx", import.meta.url),
  "utf8",
);
const customerOrderSource = fs.readFileSync(
  new URL("../pages/CustomerOrder.jsx", import.meta.url),
  "utf8",
);
const centralPageSource = fs.readFileSync(
  new URL("../pages/AdminSetup/CentralPayment.jsx", import.meta.url),
  "utf8",
);
const centralServiceSource = fs.readFileSync(
  new URL("./centralPaymentService.js", import.meta.url),
  "utf8",
);
const canonicalServiceSource = fs.readFileSync(
  new URL("./canonicalPaymentService.js", import.meta.url),
  "utf8",
);

test("login stores the FC token and database expiry in the canonical profile", () => {
  assert.match(loginSource, /fc_session_token:\s*sessionToken/);
  assert.match(loginSource, /fc_session_expires_at:\s*data\?\.expires_at/);
  assert.match(
    loginSource,
    /localStorage\.setItem\("fairchoice_user", JSON\.stringify\(loggedInUser\)\)/,
  );
  assert.match(
    loginSource,
    /localStorage\.setItem\("loggedInUser", JSON\.stringify\(loggedInUser\)\)/,
  );
});

test("Back Office and App merge refreshed identity without erasing session fields", () => {
  assert.match(
    customerOrderSource,
    /mergeAuthenticatedProfile\(activeUser, staffProfile\)/,
  );
  assert.match(
    appSource,
    /mergeAuthenticatedProfile\(\s*currentProfile,\s*userProfile/,
  );
});

test("Central Payment receives the live App profile instead of snapshotting localStorage", () => {
  assert.match(
    customerOrderSource,
    /<CentralPayment[\s\S]*currentUser=\{activeUser\}[\s\S]*onInvalidSession=\{onLogout\}/,
  );
  assert.match(
    centralPageSource,
    /export default function CentralPayment\(\{ currentUser, onInvalidSession \}\)/,
  );
  assert.doesNotMatch(
    centralPageSource,
    /useMemo\(\(\) => getLoggedInUser\(\), \[\]\)/,
  );
});

test("canonical payment uses authenticated username and FC token, never owner password", () => {
  assert.match(
    centralServiceSource,
    /fcUsername:\s*fcSession\.username/,
  );
  assert.match(
    centralServiceSource,
    /fcSessionToken:\s*fcSession\.token/,
  );
  assert.doesNotMatch(
    canonicalServiceSource,
    /ownerPassword:\s*input\.ownerPassword/,
  );
  assert.match(
    canonicalServiceSource,
    /ownerPassword:\s*input\.fcSessionToken \|\| storedSession\.token/,
  );
  assert.doesNotMatch(
    centralServiceSource,
    /postCanonicalCustomerPayment\(\{[\s\S]*ownerUsername:\s*"nisstaj_admin"/,
  );
});

test("legacy owner-password RPCs remain password based", () => {
  for (const rpcName of [
    "post_owner_central_transaction",
    "confirm_owner_bank_transfer",
    "reject_owner_bank_transfer",
  ]) {
    assert.match(
      centralServiceSource,
      new RegExp(
        `supabase\\.rpc\\("${rpcName}"[\\s\\S]*?p_owner_password:\\s*ownerPassword`,
      ),
    );
  }
  assert.doesNotMatch(
    centralPageSource,
    /owner password is used only for legacy discounts, bank review,[\s\S]*Global Ledger actions/i,
  );
});

test("missing or expired FC session blocks reads and 28000 clears state then logs out", () => {
  assert.match(centralPageSource, /const sessionReady = fcSession\.valid/);
  assert.match(
    centralPageSource,
    /if \(!sessionReady\) return undefined;[\s\S]*loadCentralPaymentCustomers/,
  );
  assert.match(centralPageSource, /setCustomers\(\[\]\)/);
  assert.match(centralPageSource, /setSnapshot\(null\)/);
  assert.match(
    centralPageSource,
    /clearFcSessionStorage\(window\.localStorage\)/,
  );
  assert.match(centralPageSource, /await onInvalidSession\?\.\(\)/);
  assert.match(
    centralPageSource,
    /isInvalidFcSessionError\(sessionError\)/,
  );
});
