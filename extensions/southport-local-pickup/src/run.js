// @ts-check

/**
 * Generate one free local pickup option backed by the Southport Warehouse
 * Shopify location, while presenting it to customers as Southport Showroom Pickup.
 *
 * @param {any} input
 * @returns {{operations: Array<any>}}
 */
export function run(input) {
  const location = (input.locations || []).find((item) =>
    String(item.name || '').trim().toLowerCase() === 'southport warehouse'
  );

  if (!location) {
    return { operations: [] };
  }

  return {
    operations: [
      {
        add: {
          title: 'Southport Showroom Pickup',
          cost: 0,
          pickupLocation: {
            locationHandle: location.handle,
            pickupInstruction:
              "We'll email you when your order is ready for collection from 9/19 Warehouse Road, Southport QLD 4215."
          }
        }
      }
    ]
  };
}
