import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { priceFromPage } from './ikeaPrice';

describe('priceFromPage', () => {
  it('reads the Offer price and stock from JSON-LD', () => {
    const html = `<script type="application/ld+json">{"@type":"Product","offers":{"@type":"Offer","price":"799","priceCurrency":"USD","availability":"https://schema.org/InStock"}}</script>`;
    expect(priceFromPage(html)).toEqual({ price: 799, currency: 'USD', inStock: true });
  });
  it('ignores pages without a price', () => {
    expect(priceFromPage('<script type="application/ld+json">{"offers":{"price":0}}</script>')).toBeNull();
  });
});
