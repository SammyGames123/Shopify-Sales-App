/**
 * Price Threshold Discount Function
 *
 * Discounts any product variant whose original price is strictly below
 * `priceThreshold` down to `discountedPrice`.
 *
 * Configuration is read from the discount node metafield
 * (namespace: "$app:price-threshold-discount", key: "configuration").
 * If no metafield is present the defaults below are used.
 *
 * Metafield value format (JSON string):
 * {
 *   "price_threshold": 49.96,   // items BELOW this price are on sale
 *   "discounted_price": 25.00   // the sale price applied to those items
 * }
 */

// ── Defaults (used when no metafield configuration is found) ─────────────────
const DEFAULT_PRICE_THRESHOLD = 49.96;
const DEFAULT_DISCOUNTED_PRICE = 25.00;

/**
 * @param {RunInput} input
 * @returns {FunctionRunResult}
 */
export function run(input) {
  // ── Load configuration ──────────────────────────────────────────────────────
  let priceThreshold = DEFAULT_PRICE_THRESHOLD;
  let discountedPrice = DEFAULT_DISCOUNTED_PRICE;

  const rawConfig = input?.discountNode?.metafield?.value;
  if (rawConfig) {
    try {
      const config = JSON.parse(rawConfig);
      if (typeof config.price_threshold === "number") {
        priceThreshold = config.price_threshold;
      }
      if (typeof config.discounted_price === "number") {
        discountedPrice = config.discounted_price;
      }
    } catch {
      // Malformed metafield — fall back to defaults
    }
  }

  // ── Build discounts ─────────────────────────────────────────────────────────
  const discounts = [];

  for (const line of input.cart.lines) {
    // Only ProductVariants carry a price; skip gift cards etc.
    if (line.merchandise.__typename !== "ProductVariant") continue;

    const originalPrice = parseFloat(line.merchandise.price.amount);

    // Apply discount only when the item is below the threshold AND
    // the discounted price would actually be lower than the original.
    if (originalPrice < priceThreshold && originalPrice > discountedPrice) {
      const discountAmount = (originalPrice - discountedPrice).toFixed(2);

      discounts.push({
        targets: [
          {
            productVariant: {
              id: line.merchandise.id,
            },
          },
        ],
        value: {
          fixedAmount: {
            // Deduct exactly (original − sale price) from each unit
            amount: discountAmount,
            appliesToEachItem: true,
          },
        },
        message: `Sale price: $${discountedPrice.toFixed(2)}`,
      });
    }
  }

  return {
    discounts,
    // FIRST means the first matching discount wins (safe for fixed-price rules)
    discountApplicationStrategy: "FIRST",
  };
}
