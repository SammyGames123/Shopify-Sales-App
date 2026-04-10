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
 * Build a cart line using the 2025-07 Functions API shape:
 *   - price is at line.cost.amountPerQuantity  (not merchandise.price)
 *   - product tags use a metafield            (not product.tags)
 */
function makeVariantLine(id, priceAmount, quantity = 1, onSale = null) {
  return {
    id: `gid://shopify/CartLine/${id}`,
    quantity,
    cost: {
      amountPerQuantity: { amount: String(priceAmount), currencyCode: "USD" },
    },
    merchandise: {
      __typename: "ProductVariant",
      id: `gid://shopify/ProductVariant/${id}`,
      product: {
        title: `Product ${id}`,
        onSale: onSale !== null ? { value: String(onSale) } : null,
      },
    },
  };
}

// ── Price threshold tests ─────────────────────────────────────────────────────

describe("Price Threshold Discount — price rules", () => {
  it("discounts an item priced below the threshold", () => {
    const result = run(makeInput({ lines: [makeVariantLine(1, 39.99)] }));
    expect(result.discounts).toHaveLength(1);
    const d = result.discounts[0];
    expect(d.value.fixedAmount.amount).toBe("14.99"); // 39.99 − 25.00
    expect(d.value.fixedAmount.appliesToEachItem).toBe(true);
    expect(d.targets[0].productVariant.id).toBe("gid://shopify/ProductVariant/1");
    expect(d.message).toBe("Sale price: $25.00");
  });

  it("does not discount an item at or above the threshold", () => {
    const result = run(makeInput({
      lines: [makeVariantLine(2, 49.96), makeVariantLine(3, 75.00)],
    }));
    expect(result.discounts).toHaveLength(0);
  });

  it("does not discount an item already at or below the sale price", () => {
    expect(run(makeInput({ lines: [makeVariantLine(4, 20.00)] })).discounts).toHaveLength(0);
  });

  it("handles multiple lines, discounting only eligible ones", () => {
    const result = run(makeInput({
      lines: [
        makeVariantLine(5, 29.99), // eligible → $25.00
        makeVariantLine(6, 49.96), // at threshold → no discount
        makeVariantLine(7, 15.00), // below sale price → no discount
        makeVariantLine(8, 99.00), // above threshold → no discount
      ],
    }));
    expect(result.discounts).toHaveLength(1);
    expect(result.discounts[0].value.fixedAmount.amount).toBe("4.99");
  });

  it("reads price_threshold and discounted_price from the metafield", () => {
    const result = run(makeInput({
      lines: [makeVariantLine(9, 60.00)],
      configOverride: { price_threshold: 70.00, discounted_price: 50.00 },
    }));
    expect(result.discounts).toHaveLength(1);
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

  it("skips non-ProductVariant merchandise", () => {
    const input = {
      cart: {
        lines: [{
          id: "gid://shopify/CartLine/99",
          quantity: 1,
          cost: { amountPerQuantity: { amount: "30.00", currencyCode: "USD" } },
          merchandise: { __typename: "CustomProduct", id: "gid://shopify/CustomProduct/99" },
        }],
      },
      discountNode: { metafield: null },
    };
    expect(run(input).discounts).toHaveLength(0);
  });

  it("returns FIRST as the discount application strategy", () => {
    const result = run(makeInput({ lines: [makeVariantLine(11, 30.00)] }));
    expect(result.discountApplicationStrategy).toBe("FIRST");
  });

  it("applies discount per item when quantity > 1", () => {
    const result = run(makeInput({ lines: [makeVariantLine(12, 45.00, 3)] }));
    expect(result.discounts).toHaveLength(1);
    expect(result.discounts[0].value.fixedAmount.appliesToEachItem).toBe(true);
    expect(result.discounts[0].value.fixedAmount.amount).toBe("20.00");
  });
});

// ── Sale tag (metafield) filter tests ─────────────────────────────────────────

describe("Price Threshold Discount — sale tag filtering", () => {
  it("discounts a tagged product when require_sale_tag is true", () => {
    const result = run(makeInput({
      lines: [makeVariantLine(20, 39.99, 1, "true")],
      configOverride: { price_threshold: 49.96, discounted_price: 25.00, require_sale_tag: true },
    }));
    expect(result.discounts).toHaveLength(1);
  });

  it("does not discount an untagged product when require_sale_tag is true", () => {
    const result = run(makeInput({
      lines: [makeVariantLine(21, 39.99, 1, null)],
      configOverride: { price_threshold: 49.96, discounted_price: 25.00, require_sale_tag: true },
    }));
    expect(result.discounts).toHaveLength(0);
  });

  it("does not discount when on_sale metafield is 'false'", () => {
    const result = run(makeInput({
      lines: [makeVariantLine(22, 39.99, 1, "false")],
      configOverride: { price_threshold: 49.96, discounted_price: 25.00, require_sale_tag: true },
    }));
    expect(result.discounts).toHaveLength(0);
  });

  it("discounts all eligible products when require_sale_tag is false (default)", () => {
    const result = run(makeInput({
      lines: [
        makeVariantLine(23, 39.99, 1, null),   // no metafield
        makeVariantLine(24, 39.99, 1, "false"), // metafield false
      ],
      configOverride: { price_threshold: 49.96, discounted_price: 25.00, require_sale_tag: false },
    }));
    expect(result.discounts).toHaveLength(2);
  });

  it("is case-insensitive for the on_sale metafield value", () => {
    const result = run(makeInput({
      lines: [makeVariantLine(25, 39.99, 1, "TRUE")],
      configOverride: { price_threshold: 49.96, discounted_price: 25.00, require_sale_tag: true },
    }));
    expect(result.discounts).toHaveLength(1);
  });

  it("combines tag AND price: tagged but above threshold gets no discount", () => {
    const result = run(makeInput({
      lines: [makeVariantLine(26, 75.00, 1, "true")],
      configOverride: { price_threshold: 49.96, discounted_price: 25.00, require_sale_tag: true },
    }));
    expect(result.discounts).toHaveLength(0);
  });
});
