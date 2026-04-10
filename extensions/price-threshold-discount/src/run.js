/**
 * Price Threshold Discount Function
 *
 * Discounts product variants that meet ALL of these conditions:
 *   1. Price (per unit) is strictly below `priceThreshold`
 *   2. Price is above `discountedPrice` (so the discount is meaningful)
 *   3. If `requireSaleTag` is true, the product must have a Shopify
 *      metafield  namespace="custom"  key="on_sale"  value="true"
 *
 * Configuration is read from the discount node metafield
 * (namespace: "$app:price-threshold-discount", key: "configuration").
 * If no metafield is present the defaults below are used.
 *
 * Metafield value format (JSON string):
 * {
 *   "price_threshold":  49.96,   // items BELOW this price are eligible
 *   "discounted_price": 25.00,   // the fixed sale price applied
 *   "require_sale_tag": false    // set true to only discount products
 *                                // tagged with metafield on_sale=true
 * }
 *
 * NOTE: The Shopify Functions 2025-07 API does not expose Product.tags
 * directly in the input schema. Tag-based selection is achieved by
 * adding a product metafield (namespace: "custom", key: "on_sale",
 * value: "true") to each product you want included in the sale.
 */

// ── Defaults ──────────────────────────────────────────────────────────────────
const DEFAULT_PRICE_THRESHOLD = 49.96;
const DEFAULT_DISCOUNTED_PRICE = 25.00;
const DEFAULT_REQUIRE_SALE_TAG = false;

/**
 * @param {RunInput} input
 * @returns {FunctionRunResult}
 */
export function run(input) {
  // ── Load configuration ──────────────────────────────────────────────────────
  let priceThreshold  = DEFAULT_PRICE_THRESHOLD;
  let discountedPrice = DEFAULT_DISCOUNTED_PRICE;
  let requireSaleTag  = DEFAULT_REQUIRE_SALE_TAG;

  const rawConfig = input?.discountNode?.metafield?.value;
  if (rawConfig) {
    try {
      const config = JSON.parse(rawConfig);
      if (typeof config.price_threshold  === "number") priceThreshold  = config.price_threshold;
      if (typeof config.discounted_price === "number") discountedPrice = config.discounted_price;
      if (typeof config.require_sale_tag === "boolean") requireSaleTag = config.require_sale_tag;
    } catch {
      // Malformed metafield — fall back to defaults
    }
  }

  // ── Build discounts ─────────────────────────────────────────────────────────
  const discounts = [];

  for (const line of input.cart.lines) {
    if (line.merchandise.__typename !== "ProductVariant") continue;

    // Price is now at the cart-line level (amountPerQuantity = price per unit
    // before this function's discounts are applied).
    const originalPrice = parseFloat(line.cost.amountPerQuantity.amount);

    // Optional: only discount products marked with the on_sale metafield
    if (requireSaleTag) {
      const onSaleValue = line.merchandise.product?.onSale?.value;
      if (onSaleValue?.toLowerCase() !== "true") continue;
    }

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
    discountApplicationStrategy: "FIRST",
  };
}
