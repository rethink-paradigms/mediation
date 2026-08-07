/**
 * S2e: domain engine resolution — pure precedence + fail-closed parsing.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  ENGINE_KINDS,
  asEngineKind,
  isEngineKind,
  resolveEngineKind,
  type EngineKind,
} from "../../src/domain/engine.ts";
import { MediationError } from "../../src/domain/errors.ts";

describe("domain/engine (S2e)", () => {
  it("ENGINE_KINDS is pi | prime | mock in order", () => {
    assert.deepEqual(ENGINE_KINDS, ["pi", "prime", "mock"]);
  });

  it("asEngineKind accepts all three kinds", () => {
    for (const kind of ENGINE_KINDS) {
      assert.equal(asEngineKind(kind), kind);
    }
  });

  it("asEngineKind throws ENGINE_UNKNOWN on unknown kinds (fail-closed)", () => {
    for (const bogus of ["bogus", "PI", "Pi", "", " prime", "earendil"]) {
      assert.throws(
        () => asEngineKind(bogus),
        (err: unknown) => {
          assert.ok(err instanceof MediationError);
          assert.equal(err.code, "ENGINE_UNKNOWN");
          assert.match(err.message, /Unknown engine kind/u);
          return true;
        },
        `expected throw for ${JSON.stringify(bogus)}`,
      );
    }
  });

  it("isEngineKind narrows to the three kinds", () => {
    assert.equal(isEngineKind("pi"), true);
    assert.equal(isEngineKind("prime"), true);
    assert.equal(isEngineKind("mock"), true);
    assert.equal(isEngineKind("bogus"), false);
    assert.equal(isEngineKind(null), false);
    assert.equal(isEngineKind(42), false);
    const narrowed: EngineKind | undefined = isEngineKind("prime")
      ? "prime"
      : undefined;
    assert.equal(narrowed, "prime");
  });

  it("resolveEngineKind falls back to built-in pi when nothing set", () => {
    assert.equal(resolveEngineKind({}), "pi");
    assert.equal(
      resolveEngineKind({ override: undefined, config: undefined, defaultEngine: undefined }),
      "pi",
    );
  });

  it("override beats config, config beats defaultEngine, default beats pi", () => {
    assert.equal(
      resolveEngineKind({ override: "mock", config: "prime", defaultEngine: "pi" }),
      "mock",
    );
    assert.equal(
      resolveEngineKind({ config: "prime", defaultEngine: "pi" }),
      "prime",
    );
    assert.equal(resolveEngineKind({ defaultEngine: "mock" }), "mock");
    assert.equal(resolveEngineKind({ defaultEngine: "pi" }), "pi");
  });

  it("each precedence position resolves independently", () => {
    assert.equal(resolveEngineKind({ override: "prime" }), "prime");
    assert.equal(resolveEngineKind({ config: "mock" }), "mock");
    assert.equal(resolveEngineKind({ defaultEngine: "prime" }), "prime");
  });

  it("resolveEngineKind validates the winning value fail-closed", () => {
    assert.throws(
      () => resolveEngineKind({ override: "bogus" as EngineKind }),
      (err: unknown) => {
        assert.ok(err instanceof MediationError);
        assert.equal(err.code, "ENGINE_UNKNOWN");
        return true;
      },
    );
    assert.throws(
      () => resolveEngineKind({ config: "bogus" as EngineKind }),
      (err: unknown) => {
        assert.ok(err instanceof MediationError);
        assert.equal(err.code, "ENGINE_UNKNOWN");
        return true;
      },
    );
    assert.throws(
      () => resolveEngineKind({ defaultEngine: "bogus" as EngineKind }),
      (err: unknown) => {
        assert.ok(err instanceof MediationError);
        assert.equal(err.code, "ENGINE_UNKNOWN");
        return true;
      },
    );
  });
});
