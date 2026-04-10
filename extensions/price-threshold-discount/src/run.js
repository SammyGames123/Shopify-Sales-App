/**
 * Price Threshold Discount Function
 *
 * Discounts product variants that:
 *   1. Have a price strictly below `priceThreshold`, AND
 *   2. Match at least one tag in `tags` (if `tags` is non-empty).
 *      When `tags` is empty or omitted, all products are eligible.
 *
 * Configuration is read from the discount node metafield
 * (namespace: "$app:price-threshold-discount", key: "configuration").
 * If no metafield is present the defaults below are used.
 *
 * Metafield value format (JSON string):
 * {
 *   "price_threshold": 49.96,        // items BELOW this price are eligible
 *   "discounted_price": 25.00,       // the fixed sale price applied
 *   "tags": ["sale", "clearance"]    // only discount products with these tags
 *                                    // omit or use [] to target ALL products
 * }
 */

// ── Defaults ──────────────────────────────────────────────────────────────────
const DEFAULT_PRICE_THRESHOLD = 49.96;
const DEFAULT_DISCOUNTED_PRICE = 25.00;
// Empty by default → no tag filter (all products are eligible)
const DEFAULT_TAGS = [];

/**
 * Returns true when the product should be considered for discounting.
 * If `allowedTags` is empty every product passes.
 * Otherwise the product must have at least one tag in `allowedTags`
 * (case-insensitive comparison).
 *
 * @param {string[]} productTags  - tags on the Shopify product
 * @param {string[]} allowedTags  - tags configured by the merchant
 * @returns {boolean}
 */
function matchesTags(productTags, allowedTags) {
  if (allowedTags.length === 0) return true;

  const normalised = productTags.map((t) => t.toLowerCase());
  return allowedTags.some((allowed) =>
    normalised.includes(allowed.toLowerCase())
  );
}

/**
 * @param {RunInput} input
 * @returns {FunctionRunResult}
 */
export function run(input) {
  // ── Load configuration ──────────────────────────────────────────────────────
  let priceThreshold = DEFAULT_PRICE_THRESHOLD;
  let discountedPrice = DEFAULT_DISCOUNTED_PRICE;
  let allowedTags = DEFAULT_TAGS;

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
      if (Array.isArray(config.tags)) {
        allowedTags = config.tags.filter((t) => typeof t === "string");
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

    const productTags = line.merchandise.product?.tags ?? [];
    const originalPrice = parseFloat(line.merchandise.price.amount);

    // Conditions:
    //  • product must match at least one allowed tag (or no tag filter set)
    //  • price must be below the threshold
    //  • discounted price must actually be lower than the original price
    if (
      matchesTags(productTags, allowedTags) &&
      originalPrice < priceThreshold &&
      originalPrice > discountedPrice
    ) {
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
