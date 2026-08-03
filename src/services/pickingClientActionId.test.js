import test from "node:test";
import assert from "node:assert/strict";
import { createClientActionId } from "./picking.js";

test("client action id works when randomUUID is unavailable", () => {
  const value = createClientActionId();
  assert.match(value, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
});
