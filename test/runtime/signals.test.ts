/**
 * OW signal naming + wake payload helpers (structure scaffold).
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  ENGAGEMENT_WAKE_KIND,
  engagementSignalName,
  engagementWakeSignal,
  parseWakeSignalData,
} from "../../src/adapters/openworkflow/signals.ts";

describe("engagement signals (scaffold)", () => {
  it("namespaces wake signal by runId", () => {
    assert.equal(
      engagementWakeSignal("run-abc"),
      "mediation:run:run-abc:wake",
    );
    assert.equal(
      engagementSignalName("run-abc", ENGAGEMENT_WAKE_KIND),
      engagementWakeSignal("run-abc"),
    );
  });

  it("parses WakeSignalData and string shorthand", () => {
    assert.deepEqual(parseWakeSignalData({ payloadText: "go", mode: "continue" }), {
      payloadText: "go",
      mode: "continue",
    });
    assert.deepEqual(parseWakeSignalData("plain"), {
      payloadText: "plain",
      mode: "continue",
    });
    assert.equal(parseWakeSignalData(null).payloadText, "");
  });
});


