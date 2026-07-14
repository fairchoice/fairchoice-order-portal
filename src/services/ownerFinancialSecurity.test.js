import fs from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";

const source = fs.readFileSync(new URL("./ownerFinancialSecurity.js", import.meta.url), "utf8");

test("owner username is fixed and no password is hard coded", () => {
  assert.match(source, /OWNER_USERNAME = "nisstaj_admin"/);
  assert.doesNotMatch(source, /adm1n@/i);
  assert.match(source, /validateOwnerPassword/);
});

test("owner security uses RPCs rather than direct table writes", () => {
  assert.match(source, /setup_owner_financial_password/);
  assert.match(source, /change_owner_financial_password/);
  assert.doesNotMatch(source, /\.from\("owner_financial_security"\)/);
});
