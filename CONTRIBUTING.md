# Contributing

## Development setup

```bash
cd packages/typescript
npm ci
npm run verify
```

Run `npm run test:live` before changing a live connection contract. Live tests must remain read-only, spend nothing, and submit no broker orders.

## Public boundary

- Do not commit credentials, wallet keys, private deployment addresses, internal hostnames, or private service inventory.
- Direct Hyperliquid commodity market data must continue to use Hyperliquid's public API rather than an Omni proxy.
- Omni API keys may be sent only in the documented `x-api-key` header.
- Broker credentials and order authority must remain inside broker-specific clients.
- New paid examples must be denied or skipped by default and enforce a per-call payment ceiling.

## Pull requests

Keep changes scoped, add regression tests, and describe any API or payment-contract impact. Run type checking, unit tests, the public-boundary scan, audit, and package inspection before requesting review.
