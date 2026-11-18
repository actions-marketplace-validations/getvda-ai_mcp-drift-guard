import { test } from "node:test";
import assert from "node:assert/strict";
import { hashTools } from "../src/canon.js";
// Expected values computed by the MCP Drift Observatory's drift_hash tool (canon_version 1), 2026-11-19.
test("byte parity with drift_hash", () => {
  const tools = [{ name: "b_tool", description: "Héllo → world", inputSchema: { type: "object", properties: { z: { type: "string" }, a: { type: "number" } } } }, { name: "a_tool", description: "x" }];
  const h = hashTools(tools);
  assert.equal(h.full_hash, "ef921ba564f07882c6065bf9193098a8d22b68aebf04c0234a29094cbe6c4046");
  assert.equal(h.per_tool.a_tool, "acbd31d2b5dae7b2f6b9e72056096877af98d7f889768017aa374f8797438f11");
  assert.equal(h.per_tool.b_tool, "c54fc3676c4d415990c4d339aab036270f0eac7c72b106e27bb8848735f30bd8");
});
