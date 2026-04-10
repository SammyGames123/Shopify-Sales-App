import { describe, it, expect } from "vitest";
import { run } from "./run.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeInput({ lines, configOverride } = {}) {
  return {
    cart: { lines: lines ?? [] },
    discountNode: {
      metafield: configOverride
        ? { value: JSON.stringify(configOverride) }
        : null,
    },
  };
}

/**
 * @param {number|string} id
 * @param {number} priceAmount
 * @param {number} [quantity]
 * @param {string[]} [tags]   - product tags
 */
function makeVariantLine(id, priceAmount, quantity = 1, tags = []) {
  return {
    id: `gid://shopify/CartLine/${id}`,
    quantity,
    merchandise: {
      __typename: "ProductVariant",
      id: `gid://shopify/ProductVariant/${id}`,
      price: { amount: String(priceAmount), currencyCode: "USD" },
      product: { title: `Product ${id}`, tags },
    },
  };
}

// ── Price threshold tests (no tag filter) ─────────────────────────────────────

describe("Price Threshold Discount Function — price rules", () => {
  it("discounts an item priced below the threshold", () => {
    const input = makeInput({ lines: [makeVariantLine(1, 39.99)] });
    const result = run(input);

    expect(result.discounts).toHaveLength(1);
    const discount = result.discounts[0];
    // 39.99 − 25.00 = 14.99
    expect(discount.value.fixedAmount.amount).toBe("14.99");
    expect(discount.value.fixedAmount.appliesToEachItem).toBe(true);
    expect(discount.targets[0].productVariant.id).toBe(
      "gid://shopify/ProductVariant/1"
    );
    expect(discount.message).toBe("Sale price: $25.00");
  });

  it("does not discount an item at or above the threshold", () => {
    const input = makeInput({
      lines: [
        makeVariantLine(2, 49.96), // exactly at threshold — no discount
        makeVariantLine(3, 75.00), // above threshold — no discount
      ],
    });
    expect(run(input).discounts).toHaveLength(0);
  });

  it("does not discount an item already at or below the sale price", () => {
    const input = makeInput({ lines: [makeVariantLine(4, 20.00)] });
    expect(run(input).discounts).toHaveLength(0);
  });

  it("handles multiple lines, discounting only eligible ones", () => {
    const input = makeInput({
      lines: [
        makeVariantLine(5, 29.99), // eligible   → $25.00
        makeVariantLine(6, 49.96), // at threshold → no discount
        makeVariantLine(7, 15.00), // below $25   → no discount
        makeVariantLine(8, 99.00), // above threshold → no discount
      ],
    });
    const result = run(input);
    expect(result.discounts).toHaveLength(1);
    expect(result.discounts[0].value.fixedAmount.amount).toBe("4.99");
  });

  it("reads price_threshold and discounted_price from the metafield", () => {
    const input = makeInput({
      lines: [makeVariantLine(9, 60.00)],
      configOverride: { price_threshold: 70.00, discounted_price: 50.00 },
    });
    const result = run(input);
    expect(result.discounts).toHaveLength(1);
    // 60.00 − 50.00 = 10.00
    expect(result.discounts[0].value.fixedAmount.amount).toBe("10.00");
    expect(result.discounts[0].message).toBe("Sale price: $50.00");
  });

  it("falls back to defaults when the metafield JSON is malformed", () => {
    const input = {
      cart: { lines: [makeVariantLine(10, 39.99)] },
      discountNode: { metafield: { value: "not-valid-json" } },
    };
    const result = run(input);
    expect(result.discounts).toHaveLength(1);
    expect(result.discounts[0].value.fixedAmount.amount).toBe("14.99");
  });

  it("skips non-ProductVariant merchandise (e.g. custom items)", () => {
    const input = {
      cart: {
        lines: [
          {
            id: "gid://shopify/CartLine/99",
            quantity: 1,
            merchandise: {
              __typename: "CustomProduct",
              id: "gid://shopify/CustomProduct/99",
            },
          },
        ],
      },
      discountNode: { metafield: null },
    };
    expect(run(input).discounts).toHaveLength(0);
  });

  it("returns FIRST as the discount application strategy", () => {
    const input = makeInput({ lines: [makeVariantLine(11, 30.00)] });
    expect(run(input).discountApplicationStrategy).toBe("FIRST");
  });

  it("applies discount per item when quantity > 1", () => {
    const input = makeInput({
      lines: [makeVariantLine(12, 45.00, 3)],
    });
    const result = run(input);
    expect(result.discounts).toHaveLength(1);
    expect(result.discounts[0].value.fixedAmount.appliesToEachItem).toBe(true);
    expect(result.discounts[0].value.fixedAmount.amount).toBe("20.00");
  });
});

// ── Tag filter tests ──────────────────────────────────────────────────────────

describe("Price Threshold Discount Function — tag filtering", () => {
  it("discounts a tagged item when that tag is in the allowed list", () => {
    const input = makeInput({
      lines: [makeVariantLine(20, 39.99, 1, ["sale", "summer"])],
      configOverride: {
        price_threshold: 49.96,
        discounted_price: 25.00,
        tags: ["sale"],
      },
    });
    const result = run(input);
    expect(result.discounts).toHaveLength(1);
    expect(result.discounts[0].value.fixedAmount.amount).toBe("14.99");
  });

  it("does not discount an item whose tags do not match the allowed list", () => {
    const input = makeInput({
      lines: [makeVariantLine(21, 39.99, 1, ["new-arrival"])],
      configOverride: {
        price_threshold: 49.96,
        discounted_price: 25.00,
        tags: ["sale"],
      },
    });
    expect(run(input).discounts).toHaveLength(0);
  });

  it("does not discount an item with no tags when a tag filter is set", () => {
    const input = makeInput({
      lines: [makeVariantLine(22, 39.99, 1, [])],
      configOverride: {
        price_threshold: 49.96,
        discounted_price: 25.00,
        tags: ["sale"],
      },
    });
    expect(run(input).discounts).toHaveLength(0);
  });

  it("discounts all eligible items when no tag filter is configured", () => {
    const input = makeInput({
      lines: [
        makeVariantLine(23, 39.99, 1, []),           // no tags
        makeVariantLine(24, 39.99, 1, ["new-arrival"]), // unrelated tag
      ],
      // no tags key in config
      configOverride: { price_threshold: 49.96, discounted_price: 25.00 },
    });
    expect(run(input).discounts).toHaveLength(2);
  });

  it("discounts all eligible items when tags is an empty array", () => {
    const input = makeInput({
      lines: [makeVariantLine(25, 39.99, 1, [])],
      configOverride: {
        price_threshold: 49.96,
        discounted_price: 25.00,
        tags: [],
      },
    });
    expect(run(input).discounts).toHaveLength(1);
  });

  it("matches any one tag from the allowed list (OR logic)", () => {
    const input = makeInput({
      lines: [
        makeVariantLine(26, 39.99, 1, ["clearance"]),
        makeVariantLine(27, 39.99, 1, ["sale"]),
        makeVariantLine(28, 39.99, 1, ["full-price"]),
      ],
      configOverride: {
        price_threshold: 49.96,
        discounted_price: 25.00,
        tags: ["sale", "clearance"],
      },
    });
    const result = run(input);
    // "clearance" and "sale" both match; "full-price" does not
    expect(result.discounts).toHaveLength(2);
  });

  it("is case-insensitive when matching tags", () => {
    const input = makeInput({
      lines: [makeVariantLine(29, 39.99, 1, ["SALE"])],
      configOverride: {
        price_threshold: 49.96,
        discounted_price: 25.00,
        tags: ["sale"],
      },
    });
    expect(run(input).discounts).toHaveLength(1);
  });

  it("combines tag AND price conditions: no discount when price is above threshold even with matching tag", () => {
    const input = makeInput({
      lines: [makeVariantLine(30, 75.00, 1, ["sale"])],
      configOverride: {
        price_threshold: 49.96,
        discounted_price: 25.00,
        tags: ["sale"],
      },
    });
    expect(run(input).discounts).toHaveLength(0);
  });

  it("ignores non-string values in the tags array", () => {
    const input = makeInput({
      lines: [makeVariantLine(31, 39.99, 1, ["sale"])],
      configOverride: {
        price_threshold: 49.96,
        discounted_price: 25.00,
        tags: ["sale", 42, null],
      },
    });
    // "sale" is a valid string → discount applied
    expect(run(input).discounts).toHaveLength(1);
  });
});
