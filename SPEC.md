# fallfloor-enterprise — specification

## Purpose

fallfloor enterprise — run the whole company's AI on machines it owns

## Contract

- **apiCostPerItem** — part of the fallfloor-enterprise public surface; deterministic, total (never throws).
- **board** — part of the fallfloor-enterprise public surface; deterministic, total (never throws).
- **capacity** — part of the fallfloor-enterprise public surface; deterministic, total (never throws).
- **coreSecondsPerItem** — part of the fallfloor-enterprise public surface; deterministic, total (never throws).
- **decide** — part of the fallfloor-enterprise public surface; deterministic, total (never throws).
- **exVat** — part of the fallfloor-enterprise public surface; deterministic, total (never throws).
- **gateCase** — part of the fallfloor-enterprise public surface; deterministic, total (never throws).
- **obligations** — part of the fallfloor-enterprise public surface; deterministic, total (never throws).
- **plan** — part of the fallfloor-enterprise public surface; deterministic, total (never throws).
- **seatShareBreakEven** — part of the fallfloor-enterprise public surface; deterministic, total (never throws).
- **sourced** — part of the fallfloor-enterprise public surface; deterministic, total (never throws).
- **tco** — part of the fallfloor-enterprise public surface; deterministic, total (never throws).
- **toGbp** — part of the fallfloor-enterprise public surface; deterministic, total (never throws).
- **verifyReceipt** — part of the fallfloor-enterprise public surface; deterministic, total (never throws).

## Guarantees

- **Deterministic** — the same input yields the same output on any machine, any run.
- **Total** — hostile or malformed input returns a defined value, never an exception.
- **Zero-dependency** — no third-party runtime code inside the trust boundary.

## Verification

The suite exercises the public surface directly and is mutation-checked: a change to any guarded line makes a
test fail. konomify admits fallfloor-enterprise only when both the structure rubric (acg-assessor) and the behaviour gate
(witness) pass.
