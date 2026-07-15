import fs from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";

const source = fs.readFileSync(new URL("./ownerFinancialSecurity.js", import.meta.url), "utf8");

test("owner username is fixed and no password is hard coded", () => {
  assert.match(source, /OWNER_USERNAME = "nisstaj_admin"/);
  assert.doesNotMatch(source, /adm1n@/i);
  assert.match(source, /isOwnerUser/);
});

test("separate owner financial security setup is completely removed", () => {
  assert.doesNotMatch(source, /setup_owner_financial_password/);
  assert.doesNotMatch(source, /change_owner_financial_password/);
  assert.doesNotMatch(source, /owner_financial_security_status/);
  assert.doesNotMatch(source, /\.from\("owner_financial_security"\)/);
});
