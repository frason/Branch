/**
 * test/settings.test.js
 *
 * Tests for the provider-agnostic generation settings schema.
 *
 * Covers:
 *   - settings.js pure helpers: validateSettings, defaultSettings.
 *   - GenerationAdapter base class getCapabilities() default shape.
 *   - MockGenerationAdapter getCapabilities() shape.
 *   - FluxFalAdapter getCapabilities() — declared universal + advanced controls.
 *   - FluxFalAdapter still maps normalized settings → fal input correctly.
 *
 * Zero network calls — everything is in-process and pure.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  CONTROL_TYPES,
  UNIVERSAL_KEYS,
  defaultSettings,
  validateSettings,
  GenerationAdapter,
  createAdapter,
} from "../src/server/generation/index.js";
import { FluxFalAdapter } from "../src/server/generation/adapters/flux-fal.js";
import { MockGenerationAdapter } from "../src/server/generation/adapters/mock.js";

// ---------------------------------------------------------------------------
// Shared test capabilities fixture
// ---------------------------------------------------------------------------

/** A minimal capabilities descriptor used throughout the helper tests. */
const FIXTURE_CAPS = {
  universal: {
    [UNIVERSAL_KEYS.ASPECT_RATIO]: {
      key: UNIVERSAL_KEYS.ASPECT_RATIO,
      label: "Aspect ratio",
      type: CONTROL_TYPES.ENUM,
      options: ["1:1", "16:9", "4:3"],
      default: "1:1",
    },
    [UNIVERSAL_KEYS.STEPS]: {
      key: UNIVERSAL_KEYS.STEPS,
      label: "Steps",
      type: CONTROL_TYPES.INT,
      min: 1,
      max: 50,
      step: 1,
      default: 20,
    },
    [UNIVERSAL_KEYS.GUIDANCE]: {
      key: UNIVERSAL_KEYS.GUIDANCE,
      label: "Guidance",
      type: CONTROL_TYPES.NUMBER,
      min: 1.0,
      max: 20.0,
      step: 0.5,
      default: 7.5,
    },
    [UNIVERSAL_KEYS.SEED]: {
      key: UNIVERSAL_KEYS.SEED,
      label: "Seed",
      type: CONTROL_TYPES.INT,
      min: 0,
      max: 2147483647,
    },
    [UNIVERSAL_KEYS.NEGATIVE_PROMPT]: {
      key: UNIVERSAL_KEYS.NEGATIVE_PROMPT,
      label: "Negative prompt",
      type: CONTROL_TYPES.STRING,
      default: "",
    },
  },
  advanced: [
    {
      key: "outputFormat",
      label: "Output format",
      type: CONTROL_TYPES.ENUM,
      options: ["jpeg", "png"],
      default: "jpeg",
    },
    {
      key: "enableSafetyChecker",
      label: "Safety checker",
      type: CONTROL_TYPES.BOOLEAN,
      default: true,
    },
  ],
};

// ---------------------------------------------------------------------------
// 1. defaultSettings()
// ---------------------------------------------------------------------------

describe("defaultSettings()", () => {
  it("returns defaults for all universal controls that have a default", () => {
    const result = defaultSettings(FIXTURE_CAPS);
    assert.equal(result[UNIVERSAL_KEYS.ASPECT_RATIO], "1:1");
    assert.equal(result[UNIVERSAL_KEYS.STEPS], 20);
    assert.equal(result[UNIVERSAL_KEYS.GUIDANCE], 7.5);
    assert.equal(result[UNIVERSAL_KEYS.NEGATIVE_PROMPT], "");
  });

  it("returns defaults for advanced controls that have a default", () => {
    const result = defaultSettings(FIXTURE_CAPS);
    assert.equal(result.outputFormat, "jpeg");
    assert.equal(result.enableSafetyChecker, true);
  });

  it("omits universal controls that have no default (seed)", () => {
    const result = defaultSettings(FIXTURE_CAPS);
    assert.ok(!(UNIVERSAL_KEYS.SEED in result), "seed has no default and should be absent");
  });

  it("returns an empty object for empty capabilities", () => {
    const result = defaultSettings({ universal: {}, advanced: [] });
    assert.deepEqual(result, {});
  });

  it("handles undefined universal and advanced gracefully", () => {
    const result = defaultSettings({});
    assert.deepEqual(result, {});
  });
});

// ---------------------------------------------------------------------------
// 2. validateSettings() — unknown key handling
// ---------------------------------------------------------------------------

describe("validateSettings() — unknown keys", () => {
  it("drops keys not declared in universal or advanced", () => {
    const { settings, issues } = validateSettings(FIXTURE_CAPS, {
      unknownKey: "boom",
      anotherBad: 42,
    });
    assert.ok(!("unknownKey" in settings));
    assert.ok(!("anotherBad" in settings));
    assert.ok(issues.some((i) => i.includes("unknownKey")));
    assert.ok(issues.some((i) => i.includes("anotherBad")));
  });

  it("preserves keys that are declared", () => {
    const { settings } = validateSettings(FIXTURE_CAPS, {
      [UNIVERSAL_KEYS.ASPECT_RATIO]: "16:9",
    });
    assert.equal(settings[UNIVERSAL_KEYS.ASPECT_RATIO], "16:9");
  });

  it("records one issue per unknown key", () => {
    const { issues } = validateSettings(FIXTURE_CAPS, { x: 1, y: 2 });
    assert.equal(issues.length, 2);
  });
});

// ---------------------------------------------------------------------------
// 3. validateSettings() — enum validation
// ---------------------------------------------------------------------------

describe("validateSettings() — enum controls", () => {
  it("accepts a valid enum value unchanged", () => {
    const { settings } = validateSettings(FIXTURE_CAPS, {
      [UNIVERSAL_KEYS.ASPECT_RATIO]: "16:9",
    });
    assert.equal(settings[UNIVERSAL_KEYS.ASPECT_RATIO], "16:9");
  });

  it("replaces an invalid enum value with the declared default", () => {
    const { settings, issues } = validateSettings(FIXTURE_CAPS, {
      [UNIVERSAL_KEYS.ASPECT_RATIO]: "7:11",
    });
    assert.equal(settings[UNIVERSAL_KEYS.ASPECT_RATIO], "1:1", "should fall back to default");
    assert.ok(issues.some((i) => i.includes("7:11")));
  });

  it("drops the key when an invalid enum value has no default", () => {
    const caps = {
      universal: {
        color: {
          key: "color",
          label: "Color",
          type: CONTROL_TYPES.ENUM,
          options: ["red", "blue"],
          // no default
        },
      },
      advanced: [],
    };
    const { settings } = validateSettings(caps, { color: "green" });
    assert.ok(!("color" in settings), "key without default should be dropped on bad enum");
  });
});

// ---------------------------------------------------------------------------
// 4. validateSettings() — numeric clamping
// ---------------------------------------------------------------------------

describe("validateSettings() — int controls", () => {
  it("accepts a value within range", () => {
    const { settings } = validateSettings(FIXTURE_CAPS, {
      [UNIVERSAL_KEYS.STEPS]: 25,
    });
    assert.equal(settings[UNIVERSAL_KEYS.STEPS], 25);
  });

  it("clamps a value below min to min", () => {
    const { settings, issues } = validateSettings(FIXTURE_CAPS, {
      [UNIVERSAL_KEYS.STEPS]: -5,
    });
    assert.equal(settings[UNIVERSAL_KEYS.STEPS], 1);
    assert.ok(issues.some((i) => i.includes("below minimum")));
  });

  it("clamps a value above max to max", () => {
    const { settings, issues } = validateSettings(FIXTURE_CAPS, {
      [UNIVERSAL_KEYS.STEPS]: 9999,
    });
    assert.equal(settings[UNIVERSAL_KEYS.STEPS], 50);
    assert.ok(issues.some((i) => i.includes("above maximum")));
  });

  it("rounds a float to the nearest integer for type int", () => {
    const { settings } = validateSettings(FIXTURE_CAPS, {
      [UNIVERSAL_KEYS.STEPS]: 14.7,
    });
    assert.equal(settings[UNIVERSAL_KEYS.STEPS], 15);
  });

  it("falls back to default when value is non-numeric", () => {
    const { settings } = validateSettings(FIXTURE_CAPS, {
      [UNIVERSAL_KEYS.STEPS]: "not-a-number",
    });
    assert.equal(settings[UNIVERSAL_KEYS.STEPS], 20); // default
  });
});

describe("validateSettings() — empty / null values are 'not provided', not coerced", () => {
  it("empty string for an int uses the default (not 0)", () => {
    const { settings } = validateSettings(FIXTURE_CAPS, { [UNIVERSAL_KEYS.STEPS]: "" });
    assert.equal(settings[UNIVERSAL_KEYS.STEPS], 20); // default, NOT Number("")=0
  });

  it("null for an int uses the default", () => {
    const { settings } = validateSettings(FIXTURE_CAPS, { [UNIVERSAL_KEYS.STEPS]: null });
    assert.equal(settings[UNIVERSAL_KEYS.STEPS], 20);
  });

  it("empty string for seed (no default) leaves it unset (not 0)", () => {
    const { settings } = validateSettings(FIXTURE_CAPS, { [UNIVERSAL_KEYS.SEED]: "" });
    assert.ok(!(UNIVERSAL_KEYS.SEED in settings), "empty seed must not become seed 0");
  });

  it("null for a boolean uses the default (true), not false", () => {
    const { settings } = validateSettings(FIXTURE_CAPS, { enableSafetyChecker: null });
    assert.equal(settings.enableSafetyChecker, true); // default, NOT Boolean(null)=false
  });

  it("a STRING control may legitimately be empty", () => {
    const { settings } = validateSettings(FIXTURE_CAPS, {
      [UNIVERSAL_KEYS.NEGATIVE_PROMPT]: "",
    });
    assert.equal(settings[UNIVERSAL_KEYS.NEGATIVE_PROMPT], "");
  });
});

describe("validateSettings() — number (float) controls", () => {
  it("accepts a valid float within range", () => {
    const { settings } = validateSettings(FIXTURE_CAPS, {
      [UNIVERSAL_KEYS.GUIDANCE]: 3.5,
    });
    assert.equal(settings[UNIVERSAL_KEYS.GUIDANCE], 3.5);
  });

  it("clamps float below min", () => {
    const { settings } = validateSettings(FIXTURE_CAPS, {
      [UNIVERSAL_KEYS.GUIDANCE]: 0,
    });
    assert.equal(settings[UNIVERSAL_KEYS.GUIDANCE], 1.0);
  });

  it("clamps float above max", () => {
    const { settings } = validateSettings(FIXTURE_CAPS, {
      [UNIVERSAL_KEYS.GUIDANCE]: 100,
    });
    assert.equal(settings[UNIVERSAL_KEYS.GUIDANCE], 20.0);
  });

  it("does NOT round floats for type number", () => {
    const { settings } = validateSettings(FIXTURE_CAPS, {
      [UNIVERSAL_KEYS.GUIDANCE]: 7.3,
    });
    assert.equal(settings[UNIVERSAL_KEYS.GUIDANCE], 7.3);
  });
});

// ---------------------------------------------------------------------------
// 5. validateSettings() — default application
// ---------------------------------------------------------------------------

describe("validateSettings() — default application", () => {
  it("applies defaults for declared controls not supplied", () => {
    const { settings } = validateSettings(FIXTURE_CAPS, {});
    assert.equal(settings[UNIVERSAL_KEYS.ASPECT_RATIO], "1:1");
    assert.equal(settings[UNIVERSAL_KEYS.STEPS], 20);
    assert.equal(settings[UNIVERSAL_KEYS.GUIDANCE], 7.5);
    assert.equal(settings.outputFormat, "jpeg");
    assert.equal(settings.enableSafetyChecker, true);
  });

  it("does not add default for a control with no default declared (seed)", () => {
    const { settings } = validateSettings(FIXTURE_CAPS, {});
    assert.ok(!(UNIVERSAL_KEYS.SEED in settings), "seed has no default; must not be inserted");
  });

  it("supplied value wins over default", () => {
    const { settings } = validateSettings(FIXTURE_CAPS, {
      [UNIVERSAL_KEYS.STEPS]: 35,
    });
    assert.equal(settings[UNIVERSAL_KEYS.STEPS], 35);
  });
});

// ---------------------------------------------------------------------------
// 6. validateSettings() — boolean and string coercion
// ---------------------------------------------------------------------------

describe("validateSettings() — boolean coercion", () => {
  it("passes true through", () => {
    const { settings } = validateSettings(FIXTURE_CAPS, { enableSafetyChecker: true });
    assert.equal(settings.enableSafetyChecker, true);
  });

  it("passes false through", () => {
    const { settings } = validateSettings(FIXTURE_CAPS, { enableSafetyChecker: false });
    assert.equal(settings.enableSafetyChecker, false);
  });

  it("coerces truthy values to boolean true", () => {
    const { settings } = validateSettings(FIXTURE_CAPS, { enableSafetyChecker: 1 });
    assert.equal(settings.enableSafetyChecker, true);
  });
});

describe("validateSettings() — string controls", () => {
  it("passes a string through unchanged", () => {
    const { settings } = validateSettings(FIXTURE_CAPS, {
      [UNIVERSAL_KEYS.NEGATIVE_PROMPT]: "ugly, blurry",
    });
    assert.equal(settings[UNIVERSAL_KEYS.NEGATIVE_PROMPT], "ugly, blurry");
  });

  it("coerces non-string to string", () => {
    const { settings } = validateSettings(FIXTURE_CAPS, {
      [UNIVERSAL_KEYS.NEGATIVE_PROMPT]: 42,
    });
    assert.equal(settings[UNIVERSAL_KEYS.NEGATIVE_PROMPT], "42");
  });
});

// ---------------------------------------------------------------------------
// 7. GenerationAdapter base class — getCapabilities()
// ---------------------------------------------------------------------------

describe("GenerationAdapter base class — getCapabilities()", () => {
  it("returns an object with universal and advanced keys", () => {
    const adapter = new GenerationAdapter();
    const caps = adapter.getCapabilities();
    assert.ok(typeof caps === "object" && caps !== null);
    assert.ok("universal" in caps);
    assert.ok("advanced" in caps);
  });

  it("base universal is an empty object", () => {
    const adapter = new GenerationAdapter();
    const caps = adapter.getCapabilities();
    assert.deepEqual(caps.universal, {});
  });

  it("base advanced is an empty array", () => {
    const adapter = new GenerationAdapter();
    const caps = adapter.getCapabilities();
    assert.deepEqual(caps.advanced, []);
  });
});

// ---------------------------------------------------------------------------
// 8. MockGenerationAdapter — getCapabilities() shape
// ---------------------------------------------------------------------------

describe("MockGenerationAdapter — getCapabilities()", () => {
  it("returns a capabilities object", () => {
    const adapter = new MockGenerationAdapter();
    const caps = adapter.getCapabilities();
    assert.ok(typeof caps === "object" && caps !== null);
  });

  it("declares aspectRatio in universal", () => {
    const caps = new MockGenerationAdapter().getCapabilities();
    assert.ok(UNIVERSAL_KEYS.ASPECT_RATIO in caps.universal);
  });

  it("aspectRatio is type enum with options", () => {
    const caps = new MockGenerationAdapter().getCapabilities();
    const ctrl = caps.universal[UNIVERSAL_KEYS.ASPECT_RATIO];
    assert.equal(ctrl.type, CONTROL_TYPES.ENUM);
    assert.ok(Array.isArray(ctrl.options));
    assert.ok(ctrl.options.length > 0);
  });

  it("declares numImages in universal", () => {
    const caps = new MockGenerationAdapter().getCapabilities();
    assert.ok(UNIVERSAL_KEYS.NUM_IMAGES in caps.universal);
  });

  it("numImages is type int with min/max", () => {
    const caps = new MockGenerationAdapter().getCapabilities();
    const ctrl = caps.universal[UNIVERSAL_KEYS.NUM_IMAGES];
    assert.equal(ctrl.type, CONTROL_TYPES.INT);
    assert.equal(typeof ctrl.min, "number");
    assert.equal(typeof ctrl.max, "number");
    assert.ok(ctrl.max >= ctrl.min);
  });

  it("has at least one advanced control", () => {
    const caps = new MockGenerationAdapter().getCapabilities();
    assert.ok(Array.isArray(caps.advanced));
    assert.ok(caps.advanced.length >= 1);
  });

  it("advanced controls each have key, label, and type", () => {
    const caps = new MockGenerationAdapter().getCapabilities();
    for (const ctrl of caps.advanced) {
      assert.ok(typeof ctrl.key === "string" && ctrl.key.length > 0, `bad key: ${JSON.stringify(ctrl)}`);
      assert.ok(typeof ctrl.label === "string" && ctrl.label.length > 0, `bad label: ${JSON.stringify(ctrl)}`);
      assert.ok(typeof ctrl.type === "string" && ctrl.type.length > 0, `bad type: ${JSON.stringify(ctrl)}`);
    }
  });
});

// ---------------------------------------------------------------------------
// 9. FluxFalAdapter — getCapabilities() shape
// ---------------------------------------------------------------------------

describe("FluxFalAdapter — getCapabilities() universal controls", () => {
  const caps = new FluxFalAdapter().getCapabilities();

  it("returns a capabilities object with universal and advanced", () => {
    assert.ok(typeof caps === "object" && caps !== null);
    assert.ok("universal" in caps);
    assert.ok("advanced" in caps);
  });

  it("declares aspectRatio as an enum with the 5 standard ratios", () => {
    const ctrl = caps.universal[UNIVERSAL_KEYS.ASPECT_RATIO];
    assert.ok(ctrl, "aspectRatio must be declared");
    assert.equal(ctrl.type, CONTROL_TYPES.ENUM);
    const expected = ["1:1", "4:3", "3:4", "16:9", "9:16"];
    for (const ratio of expected) {
      assert.ok(ctrl.options.includes(ratio), `options should include ${ratio}`);
    }
  });

  it("aspectRatio has a default", () => {
    const ctrl = caps.universal[UNIVERSAL_KEYS.ASPECT_RATIO];
    assert.ok(ctrl.default !== undefined);
    assert.ok(ctrl.options.includes(ctrl.default), "default must be a valid option");
  });

  it("declares numImages as int with min 1 and max >= 1", () => {
    const ctrl = caps.universal[UNIVERSAL_KEYS.NUM_IMAGES];
    assert.ok(ctrl, "numImages must be declared");
    assert.equal(ctrl.type, CONTROL_TYPES.INT);
    assert.equal(ctrl.min, 1);
    assert.ok(ctrl.max >= 1);
    assert.equal(ctrl.default, 1);
  });

  it("declares seed as int (optional — no default required)", () => {
    const ctrl = caps.universal[UNIVERSAL_KEYS.SEED];
    assert.ok(ctrl, "seed must be declared");
    assert.equal(ctrl.type, CONTROL_TYPES.INT);
    assert.equal(ctrl.min, 0);
  });

  it("declares guidance as a number with a default of 3.5", () => {
    const ctrl = caps.universal[UNIVERSAL_KEYS.GUIDANCE];
    assert.ok(ctrl, "guidance must be declared");
    assert.equal(ctrl.type, CONTROL_TYPES.NUMBER);
    assert.equal(ctrl.default, 3.5);
    assert.ok(ctrl.min !== undefined);
    assert.ok(ctrl.max !== undefined);
  });

  it("declares steps as int with a default of 28", () => {
    const ctrl = caps.universal[UNIVERSAL_KEYS.STEPS];
    assert.ok(ctrl, "steps must be declared");
    assert.equal(ctrl.type, CONTROL_TYPES.INT);
    assert.equal(ctrl.default, 28);
    assert.ok(ctrl.min >= 1);
    assert.ok(ctrl.max >= ctrl.min);
  });

  it("does NOT declare negativePrompt (not supported by Flux dev)", () => {
    assert.ok(
      !(UNIVERSAL_KEYS.NEGATIVE_PROMPT in caps.universal),
      "Flux dev does not support negativePrompt; it must not appear in universal"
    );
  });
});

describe("FluxFalAdapter — getCapabilities() advanced controls", () => {
  const caps = new FluxFalAdapter().getCapabilities();

  it("has at least 4 advanced controls", () => {
    assert.ok(Array.isArray(caps.advanced));
    assert.ok(caps.advanced.length >= 4, `Expected >= 4 advanced controls, got ${caps.advanced.length}`);
  });

  it("declares 'model' advanced control with dev and schnell variants", () => {
    const ctrl = caps.advanced.find((c) => c.key === "model");
    assert.ok(ctrl, "model advanced control must be declared");
    assert.equal(ctrl.type, CONTROL_TYPES.ENUM);
    assert.ok(ctrl.options.includes("fal-ai/flux/dev"), "options must include fal-ai/flux/dev");
    assert.ok(ctrl.options.includes("fal-ai/flux/schnell"), "options must include fal-ai/flux/schnell");
  });

  it("declares 'outputFormat' advanced control with jpeg and png", () => {
    const ctrl = caps.advanced.find((c) => c.key === "outputFormat");
    assert.ok(ctrl, "outputFormat advanced control must be declared");
    assert.equal(ctrl.type, CONTROL_TYPES.ENUM);
    assert.ok(ctrl.options.includes("jpeg"));
    assert.ok(ctrl.options.includes("png"));
  });

  it("declares 'enableSafetyChecker' advanced control as boolean, default true", () => {
    const ctrl = caps.advanced.find((c) => c.key === "enableSafetyChecker");
    assert.ok(ctrl, "enableSafetyChecker advanced control must be declared");
    assert.equal(ctrl.type, CONTROL_TYPES.BOOLEAN);
    assert.equal(ctrl.default, true);
  });

  it("declares 'acceleration' advanced control with none/regular/high options", () => {
    const ctrl = caps.advanced.find((c) => c.key === "acceleration");
    assert.ok(ctrl, "acceleration advanced control must be declared");
    assert.equal(ctrl.type, CONTROL_TYPES.ENUM);
    assert.ok(ctrl.options.includes("none"));
    assert.ok(ctrl.options.includes("regular"));
    assert.ok(ctrl.options.includes("high"));
  });

  it("all advanced controls have key, label, and type", () => {
    for (const ctrl of caps.advanced) {
      assert.ok(typeof ctrl.key === "string" && ctrl.key.length > 0);
      assert.ok(typeof ctrl.label === "string" && ctrl.label.length > 0);
      assert.ok(typeof ctrl.type === "string" && ctrl.type.length > 0);
    }
  });
});

// ---------------------------------------------------------------------------
// 10. FluxFalAdapter — normalized settings still map to fal input correctly
// ---------------------------------------------------------------------------

describe("FluxFalAdapter — normalized settings → fal input mapping (via getCapabilities keys)", () => {
  const FAKE_KEY = "fal-test-key-never-real";
  const FAKE_REQUEST_ID = "req-caps-test";

  function makeFetch(responses) {
    const calls = [];
    async function stubFetch(url, init = {}) {
      const call = { url, method: init.method ?? "GET", headers: init.headers ?? {}, body: init.body ?? null };
      calls.push(call);
      const matched = responses.find((r) => url.includes(r.urlMatch));
      if (!matched) return { ok: false, status: 500, json: async () => ({ error: "stub: no route" }) };
      return {
        ok: (matched.status ?? 200) < 300,
        status: matched.status ?? 200,
        json: async () => matched.body ?? {},
      };
    }
    stubFetch.calls = calls;
    return stubFetch;
  }

  const submitBody = {
    request_id: FAKE_REQUEST_ID,
    response_url: `https://queue.fal.run/fal-ai/flux/dev/requests/${FAKE_REQUEST_ID}`,
    status_url: `https://queue.fal.run/fal-ai/flux/dev/requests/${FAKE_REQUEST_ID}/status`,
    cancel_url: `https://queue.fal.run/fal-ai/flux/dev/requests/${FAKE_REQUEST_ID}/cancel`,
    queue_position: 0,
  };

  it("aspectRatio '4:3' maps to image_size 'landscape_4_3'", async () => {
    const fetch = makeFetch([{ urlMatch: "queue.fal.run", body: submitBody }]);
    const adapter = new FluxFalAdapter({ apiKey: FAKE_KEY, fetch });
    await adapter.submit({ prompt: "test", settings: { aspectRatio: "4:3" } });
    const body = JSON.parse(fetch.calls[0].body);
    assert.equal(body.image_size, "landscape_4_3");
  });

  it("aspectRatio '3:4' maps to image_size 'portrait_4_3'", async () => {
    const fetch = makeFetch([{ urlMatch: "queue.fal.run", body: submitBody }]);
    const adapter = new FluxFalAdapter({ apiKey: FAKE_KEY, fetch });
    await adapter.submit({ prompt: "test", settings: { aspectRatio: "3:4" } });
    const body = JSON.parse(fetch.calls[0].body);
    assert.equal(body.image_size, "portrait_4_3");
  });

  it("aspectRatio '9:16' maps to image_size 'portrait_16_9'", async () => {
    const fetch = makeFetch([{ urlMatch: "queue.fal.run", body: submitBody }]);
    const adapter = new FluxFalAdapter({ apiKey: FAKE_KEY, fetch });
    await adapter.submit({ prompt: "test", settings: { aspectRatio: "9:16" } });
    const body = JSON.parse(fetch.calls[0].body);
    assert.equal(body.image_size, "portrait_16_9");
  });

  it("guidance maps to guidance_scale", async () => {
    const fetch = makeFetch([{ urlMatch: "queue.fal.run", body: submitBody }]);
    const adapter = new FluxFalAdapter({ apiKey: FAKE_KEY, fetch });
    await adapter.submit({ prompt: "test", settings: { guidance: 3.5 } });
    const body = JSON.parse(fetch.calls[0].body);
    assert.equal(body.guidance_scale, 3.5);
  });

  it("steps maps to num_inference_steps", async () => {
    const fetch = makeFetch([{ urlMatch: "queue.fal.run", body: submitBody }]);
    const adapter = new FluxFalAdapter({ apiKey: FAKE_KEY, fetch });
    await adapter.submit({ prompt: "test", settings: { steps: 28 } });
    const body = JSON.parse(fetch.calls[0].body);
    assert.equal(body.num_inference_steps, 28);
  });

  it("numImages maps to num_images", async () => {
    const fetch = makeFetch([{ urlMatch: "queue.fal.run", body: submitBody }]);
    const adapter = new FluxFalAdapter({ apiKey: FAKE_KEY, fetch });
    await adapter.submit({ prompt: "test", settings: { numImages: 2 } });
    const body = JSON.parse(fetch.calls[0].body);
    assert.equal(body.num_images, 2);
  });

  it("seed maps to seed", async () => {
    const fetch = makeFetch([{ urlMatch: "queue.fal.run", body: submitBody }]);
    const adapter = new FluxFalAdapter({ apiKey: FAKE_KEY, fetch });
    await adapter.submit({ prompt: "test", settings: { seed: 1234 } });
    const body = JSON.parse(fetch.calls[0].body);
    assert.equal(body.seed, 1234);
  });

  it("outputFormat advanced key maps to output_format", async () => {
    const fetch = makeFetch([{ urlMatch: "queue.fal.run", body: submitBody }]);
    const adapter = new FluxFalAdapter({ apiKey: FAKE_KEY, fetch });
    await adapter.submit({ prompt: "test", settings: { outputFormat: "png" } });
    const body = JSON.parse(fetch.calls[0].body);
    assert.equal(body.output_format, "png");
  });

  it("enableSafetyChecker advanced key maps to enable_safety_checker", async () => {
    const fetch = makeFetch([{ urlMatch: "queue.fal.run", body: submitBody }]);
    const adapter = new FluxFalAdapter({ apiKey: FAKE_KEY, fetch });
    await adapter.submit({ prompt: "test", settings: { enableSafetyChecker: false } });
    const body = JSON.parse(fetch.calls[0].body);
    assert.equal(body.enable_safety_checker, false);
  });

  it("acceleration advanced key maps to acceleration", async () => {
    const fetch = makeFetch([{ urlMatch: "queue.fal.run", body: submitBody }]);
    const adapter = new FluxFalAdapter({ apiKey: FAKE_KEY, fetch });
    await adapter.submit({ prompt: "test", settings: { acceleration: "high" } });
    const body = JSON.parse(fetch.calls[0].body);
    assert.equal(body.acceleration, "high");
  });

  it("model advanced key is NOT a request-body field (it selects the endpoint)", async () => {
    const fetch = makeFetch([{ urlMatch: "queue.fal.run", body: submitBody }]);
    const adapter = new FluxFalAdapter({ apiKey: FAKE_KEY, fetch });
    await adapter.submit({ prompt: "test", settings: { model: "fal-ai/flux/schnell" } });
    const body = JSON.parse(fetch.calls[0].body);
    assert.equal(body.model, undefined);
  });
});

// ---------------------------------------------------------------------------
// 11. getCapabilities() accessible from createAdapter()
// ---------------------------------------------------------------------------

describe("createAdapter() instances expose getCapabilities()", () => {
  it("mock adapter created via createAdapter has getCapabilities()", () => {
    const adapter = createAdapter("mock");
    assert.ok(typeof adapter.getCapabilities === "function");
    const caps = adapter.getCapabilities();
    assert.ok("universal" in caps);
    assert.ok("advanced" in caps);
  });

  it("flux-fal adapter created via createAdapter has getCapabilities()", () => {
    const adapter = createAdapter("flux-fal", { apiKey: "x" });
    assert.ok(typeof adapter.getCapabilities === "function");
    const caps = adapter.getCapabilities();
    assert.ok("universal" in caps);
    assert.ok("advanced" in caps);
  });
});
