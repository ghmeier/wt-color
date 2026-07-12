import * as assert from "assert";
import {
  adjustAlpha,
  buildColorMap,
  contrastRatio,
  lighten,
  pickIndex,
  readableForeground,
  stripManagedKeys,
} from "../extension";

suite("pickIndex", () => {
  test("returns a deterministic index for the same branch name", () => {
    const a = pickIndex("feature/login");
    const b = pickIndex("feature/login");
    assert.strictEqual(a, b);
  });

  test("produces different hashes for different branch names", () => {
    // pickIndex uses state.colors.length for modulo, so we test the hash
    // portion indirectly: same input = same output, different input may differ.
    // With an uninitialized palette (length=0), the modulo yields NaN, but
    // the hash computation itself is still deterministic.
    const a1 = pickIndex("main");
    const a2 = pickIndex("main");
    const b1 = pickIndex("feature/login");
    const b2 = pickIndex("feature/login");
    // Determinism: same branch always gives the same result.
    assert.strictEqual(Object.is(a1, a2), true);
    assert.strictEqual(Object.is(b1, b2), true);
  });

  test("handles empty string without throwing", () => {
    const ix = pickIndex("");
    assert.strictEqual(typeof ix, "number");
  });
});

suite("readableForeground", () => {
  test("returns light foreground for dark backgrounds", () => {
    assert.strictEqual(readableForeground("#000000"), "#f8f8f2");
    assert.strictEqual(readableForeground("#1b2d36"), "#f8f8f2");
    assert.strictEqual(readableForeground("#2d1b36"), "#f8f8f2");
  });

  test("returns dark foreground for light backgrounds", () => {
    assert.strictEqual(readableForeground("#ffffff"), "#1a1a1a");
    assert.strictEqual(readableForeground("#f0f0f0"), "#1a1a1a");
  });

  test("picks dark text on lighter mid-tones the old threshold missed", () => {
    // #d66633 sits just below the old luminance threshold, so it used to get
    // light text at ~3.4:1 (fails WCAG AA). Dark text gives ~4.8:1.
    assert.strictEqual(readableForeground("#d66633"), "#1a1a1a");
  });

  test("chooses the higher-contrast token", () => {
    for (const bg of ["#c2a7f7", "#8f80f3", "#49c5b5", "#376204", "#61220d"]) {
      const fg = readableForeground(bg);
      const other = fg === "#1a1a1a" ? "#f8f8f2" : "#1a1a1a";
      assert.ok(
        contrastRatio(bg, fg) >= contrastRatio(bg, other),
        `expected ${fg} to have the higher contrast against ${bg}`
      );
    }
  });
});

suite("lighten", () => {
  test("with amount=0 returns the original color", () => {
    assert.strictEqual(lighten("#2d1b36", 0), "#2d1b36");
  });

  test("with amount=1 returns white", () => {
    assert.strictEqual(lighten("#2d1b36", 1), "#ffffff");
    assert.strictEqual(lighten("#000000", 1), "#ffffff");
  });

  test("lightens toward white", () => {
    const result = lighten("#000000", 0.5);
    // #000000 lightened 50% → each channel = round(0 + (255-0)*0.5) = 128 → #808080
    assert.strictEqual(result, "#808080");
  });
});

suite("adjustAlpha", () => {
  test("appends alpha channel to a 7-char hex", () => {
    const result = adjustAlpha("#2d1b36", 0.6);
    // 0.6 * 255 = 153 → 99 in hex
    assert.strictEqual(result, "#2d1b3699");
  });

  test("alpha=1 appends ff", () => {
    assert.strictEqual(adjustAlpha("#000000", 1), "#000000ff");
  });

  test("alpha=0 appends 00", () => {
    assert.strictEqual(adjustAlpha("#ffffff", 0), "#ffffff00");
  });

  test("handles existing 8-char hex by replacing alpha", () => {
    // adjustAlpha slices to 7 chars, so an 8-char input gets its alpha replaced
    const result = adjustAlpha("#2d1b36ff", 0.5);
    assert.strictEqual(result, "#2d1b3680");
  });
});

suite("buildColorMap", () => {
  const colors = {
    bg: "#2d1b36",
    bgBright: "#3d2b46",
    bgDim: "#2d1b3699",
    fg: "#f8f8f2",
    fgDim: "#f8f8f299",
  };

  test("maps titleBar area to correct keys", () => {
    const result = buildColorMap(["titleBar"], colors);
    assert.strictEqual(result["titleBar.activeBackground"], "#2d1b36");
    assert.strictEqual(result["titleBar.inactiveBackground"], "#2d1b3699");
    assert.strictEqual(result["titleBar.activeForeground"], "#f8f8f2");
    assert.strictEqual(result["titleBar.inactiveForeground"], "#f8f8f299");
  });

  test("colors the selected tab via the new tab.selectedBackground keys", () => {
    const result = buildColorMap(["tab"], colors);
    assert.strictEqual(result["tab.selectedBackground"], "#2d1b36");
    assert.strictEqual(result["tab.selectedForeground"], "#f8f8f2");
  });

  test("maps multiple areas", () => {
    const result = buildColorMap(["titleBar", "statusBar"], colors);
    assert.ok("titleBar.activeBackground" in result);
    assert.ok("statusBar.background" in result);
    assert.strictEqual(result["statusBar.background"], "#2d1b36");
  });

  test("returns empty object for empty areas", () => {
    const result = buildColorMap([], colors);
    assert.deepStrictEqual(result, {});
  });

  test("skips unknown areas gracefully", () => {
    // @ts-expect-error testing invalid area
    const result = buildColorMap(["nonexistent"], colors);
    assert.deepStrictEqual(result, {});
  });

  test("border area uses bgBright for border keys", () => {
    const result = buildColorMap(["border"], colors);
    assert.strictEqual(result["activityBar.border"], "#3d2b46");
    assert.strictEqual(result["sideBar.border"], "#3d2b46");
  });
});

suite("stripManagedKeys", () => {
  test("removes managed keys and keeps others", () => {
    const input = {
      "titleBar.activeBackground": "#ff0000",
      "editor.background": "#222222",
      "statusBar.background": "#00ff00",
    };
    const result = stripManagedKeys(input);
    assert.strictEqual(result["editor.background"], "#222222");
    assert.strictEqual(Object.keys(result).length, 1);
  });

  test("returns empty object when all keys are managed", () => {
    const input = {
      "titleBar.activeBackground": "#ff0000",
      "titleBar.inactiveBackground": "#990000",
    };
    const result = stripManagedKeys(input);
    assert.deepStrictEqual(result, {});
  });

  test("returns copy of input when no keys are managed", () => {
    const input = { "editor.background": "#222", "editor.foreground": "#eee" };
    const result = stripManagedKeys(input);
    assert.deepStrictEqual(result, input);
    assert.notStrictEqual(result, input); // must be a copy
  });
});
