# SDK dependency security

SDK and testnet-agent CI now run a full-tree critical npm audit before existing
verification. This covers build/test dependencies too, while retaining the
stricter existing runtime-only audit in `verify`. Audit failures are not ignored.
The existing no-spend and explicitly confirmed funded-testnet job boundaries
are unchanged. A dependency change must never enable funded tests implicitly.

Both locks received compatible transitive updates, without force-upgrading direct
dependencies. On 2026-10-07, fresh clean installs and full npm audits reported zero
known advisories in both trees. Offline SDK verification passed 34 tests, build,
type-check, demo examples, public-boundary/docs checks and package consumer smoke;
agent verification passed 6 offline tests and type-check.

These tests use no wallet credentials and submit no trades or payments. Live
endpoint compatibility and release publication are distinct follow-up gates.
