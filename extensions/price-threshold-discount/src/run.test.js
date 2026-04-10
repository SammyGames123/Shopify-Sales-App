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

function makeVariantLine(id, priceAmount, quantity = 1) {
  return {
    id: `gid://shopify/CartLine/${id}`,
    quantity,
    merchandise: {
      __typename: "ProductVariant",
      id: `gid://shopify/ProductVariant/${id}`,
      price: { amount: String(priceAmount), currencyCode: "USD" },
      product: { title: `Product ${id}` },
    },
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("Price Threshold Discount Function", () => {
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
    const result = run(input);

    expect(result.discounts).toHaveLength(0);
  });

  it("does not discount an item already at or below the sale price", () => {
    // Item is $20 — below threshold, but already cheaper than $25 sale price
    const input = makeInput({ lines: [makeVariantLine(4, 20.00)] });
    const result = run(input);

    expect(result.discounts).toHaveLength(0);
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

    // Default threshold 49.96, default sale price 25.00 → discount applied
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
    const result = run(input);

    expect(result.discounts).toHaveLength(0);
  });

  it("returns FIRST as the discount application strategy", () => {
    const input = makeInput({ lines: [makeVariantLine(11, 30.00)] });
    const result = run(input);

    expect(result.discountApplicationStrategy).toBe("FIRST");
  });

  it("applies discount per item when quantity > 1", () => {
    const input = makeInput({
      lines: [makeVariantLine(12, 45.00, 3)],
    });
    const result = run(input);

    expect(result.discounts).toHaveLength(1);
    // appliesToEachItem:true means Shopify multiplies by quantity automatically
    expect(result.discounts[0].value.fixedAmount.appliesToEachItem).toBe(true);
    expect(result.discounts[0].value.fixedAmount.amount).toBe("20.00");
  });
});
