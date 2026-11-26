import { describe, expect, test } from "bun:test";
import {
  isWildcardDeclaration,
  propertyFamily,
} from "../../packages/compiler/src/lowering/index.ts";

/**
 * Frozen property-family data for merge grouping (ADR-0024).
 *
 * These assertions are the contract the merge pass relies on: only families
 * declared disjoint may be crossed. They pin representative families, vendor
 * prefix stripping, custom-property identity, wildcard barriers and the
 * cross-prefix shorthand groups the base rule cannot derive textually.
 */
describe("property families", () => {
  test("takes the segment before the first dash", () => {
    expect(propertyFamily("background-color", "red")).toBe("background");
    expect(propertyFamily("border-left-color", "red")).toBe("border");
    expect(propertyFamily("grid-template-columns", "1fr")).toBe("grid");
    expect(propertyFamily("margin-block", "0")).toBe("margin");
    expect(propertyFamily("padding-inline-start", "0")).toBe("padding");
  });

  test("strips one vendor prefix before classifying", () => {
    expect(propertyFamily("-webkit-transform", "none")).toBe("transform");
    expect(propertyFamily("-moz-appearance", "none")).toBe("appearance");
    expect(propertyFamily("-ms-flex-align", "center")).toBe("align");
    expect(propertyFamily("-o-object-fit", "cover")).toBe("object");
    expect(propertyFamily("-WEBKIT-TRANSFORM", "none")).toBe("transform");
    expect(propertyFamily("-webkit-background-clip", "text")).toBe("background");
  });

  test("custom properties keep their full, case-sensitive name", () => {
    expect(propertyFamily("--brand", "red")).toBe("--brand");
    expect(propertyFamily("--brand-color", "red")).toBe("--brand-color");
    expect(propertyFamily("--Brand", "red")).not.toBe(propertyFamily("--brand", "red"));
  });

  test("`all` and `var()` values are wildcards", () => {
    expect(isWildcardDeclaration("all", "unset")).toBe(true);
    expect(isWildcardDeclaration("ALL", "revert")).toBe(true);
    expect(isWildcardDeclaration("color", "var(--brand)")).toBe(true);
    expect(isWildcardDeclaration("color", "VAR( --brand )")).toBe(true);
    expect(isWildcardDeclaration("color", "red")).toBe(false);
    expect(propertyFamily("color", "var(--brand)")).toBeNull();
  });

  test("unknown vendor spellings are conservative wildcards", () => {
    expect(propertyFamily("-khtml-opacity", "1")).toBeNull();
    expect(propertyFamily("", "red")).toBeNull();
  });

  test("cross-prefix shorthands map to one family", () => {
    // `inset` expands into the four physical offsets.
    expect(propertyFamily("inset", "0")).toBe(propertyFamily("top", "0"));
    expect(propertyFamily("top", "0")).toBe(propertyFamily("left", "0"));
    // `place-*` expands into align/justify longhands.
    expect(propertyFamily("place-items", "center")).toBe(propertyFamily("align-items", "center"));
    expect(propertyFamily("justify-content", "center")).toBe(
      propertyFamily("align-content", "center"),
    );
    // `gap`, `columns`, `line-clamp`, `white-space` and logical sizing.
    expect(propertyFamily("row-gap", "1px")).toBe(propertyFamily("gap", "1px"));
    expect(propertyFamily("grid-column-gap", "1px")).toBe(propertyFamily("gap", "1px"));
    expect(propertyFamily("column-count", "2")).toBe(propertyFamily("columns", "2"));
    expect(propertyFamily("max-lines", "2")).toBe(propertyFamily("line-clamp", "2"));
    expect(propertyFamily("text-wrap-mode", "nowrap")).toBe(
      propertyFamily("white-space", "nowrap"),
    );
    expect(propertyFamily("width", "1px")).toBe(propertyFamily("inline-size", "1px"));
    expect(propertyFamily("height", "1px")).toBe(propertyFamily("block-size", "1px"));
    // `font` resets `line-height`; legacy aliases follow their canonical name.
    expect(propertyFamily("line-height", "1.5")).toBe(propertyFamily("font", "16px serif"));
    expect(propertyFamily("word-wrap", "anywhere")).toBe(
      propertyFamily("overflow-wrap", "anywhere"),
    );
    expect(propertyFamily("page-break-before", "always")).toBe(
      propertyFamily("break-before", "page"),
    );
  });

  test("unrelated families stay distinct", () => {
    expect(propertyFamily("color", "red")).not.toBe(propertyFamily("background-color", "red"));
    expect(propertyFamily("margin", "0")).not.toBe(propertyFamily("padding", "0"));
    expect(propertyFamily("width", "1px")).not.toBe(propertyFamily("min-width", "1px"));
  });
});
