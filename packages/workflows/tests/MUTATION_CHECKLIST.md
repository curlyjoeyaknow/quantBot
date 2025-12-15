# Workflows Mutation Checklist (Test Bite Sanity)

Make ONE change at a time. Re-run:
- pnpm -C packages/workflows test:coverage

If tests stay green, they're too weak (or you're mutating the wrong spot).

## Spec validation / dates
1) Allow empty strategyName -> should fail `INVALID_SPEC`
2) Remove to<=from check -> should fail `INVALID_DATE_RANGE`
3) Swap from/to in repo calls.list query -> should fail ordering / selection assumptions
4) Treat callerName="" as valid -> should fail spec validation

## Strategy handling
5) If strategy missing, silently return empty result -> should fail `STRATEGY_NOT_FOUND` test
6) Load strategy after calls.list -> should fail "fails fast" expectations

## Call handling
7) Remove dedupe by call.id -> should fail dedupe test
8) Sort calls descending -> should fail stable ordering test
9) Stop on first per-call error -> should fail per-call error continues test
10) Count callsFound as uniqueCalls length -> should fail callsFound vs attempted expectations

## Candle fetching
11) If candles empty, still call simulation.run -> should fail NO_CANDLES test
12) Remove pre/post window logic -> should fail windowing test
13) Apply pre/post in wrong direction (plus/minus swapped) -> should fail windowing test
14) Use spec.from/spec.to window for all calls (ignore call timestamp) -> should fail windowing test (if you add a second call w/ different timestamp)

## Persistence
15) Persist even when dryRun=true -> should fail dryRun no persist test
16) Don't persist when dryRun=false -> should fail persist test
17) Persist before simulation loop and crash on per-call error -> should fail per-call error continues test

## Stats correctness
18) Include failed calls in pnl stats -> should fail per-call error pnl stats ignore failures
19) median implemented wrong (e.g. pick lower mid) -> should fail median expectations
20) mean computed with integer division / rounding early -> should fail mean precision

## Error reporting
21) Use errorCode="ERROR" for all failures -> should fail NO_CANDLES / SIMULATION_ERROR expectations
22) Drop errorMessage -> should fail per-call error message match

## Logging / determinism (optional)
23) Use Date.now directly -> tests become flaky when you add time assertions (keep ctx.clock)
24) Use random UUID directly -> you lose deterministic runId assertions

