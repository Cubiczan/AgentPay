# AgentPay (v1) — Lean verification notes

Model: `PaymentFlow.lean` (660 lines, 19 theorems, Lean 4.34.1, core library
only). Compiles with plain `~/.elan/bin/lean PaymentFlow.lean`, exit 0. No
`sorry`/`admit`/custom axioms; `#print axioms` shows the checked theorems
depend only on `propext` / `Quot.sound` (several on no axioms at all).
No source files were modified.

Scope: the treasury payment flow (`src/lib/treasury/agent.ts`, 612 lines),
the on-chain verification helper (`src/lib/casper/contracts.ts`), the direct
service-call route (`src/app/api/services/[id]/call/route.ts`), the treasury
trigger route (`src/app/api/treasury/run/route.ts`), and `prisma/schema.prisma`.
Amounts are modelled in `Nat` (whole CSPR units); the code uses IEEE-754
`number` CSPR amounts converted to motes via `BigInt` inside execution, so
float-rounding behaviour is out of scope for the model (see Risk 9).

## Model ↔ source mapping

| Model element | Source |
|---|---|
| `Cfg` (`enabled`, `dryRun`, `minBalance`, `cap`) | `TreasuryConfig` row (schema.prisma); `getTreasuryConfig`/`updateTreasuryConfig`, agent.ts:58–81. Defaults: enabled=true, minBalanceCSPR=0.5, maxSpendPerCycleCSPR=2.0, dryRun=false |
| `Service.price` | `service.pricePerCall` — the amount charged always comes from the DB row, never from the LLM (agent.ts:205, 479) |
| `AgentIn` (`onChain`, `balance`) | Agent query `status='active'` (+ `isOnChain: true` in LIVE mode only), agent.ts:320–327; balance refresh, agent.ts:~340–360 |
| `Oracle : Nat → Option Nat` | `callLLM` (agent.ts:83–98) + `parseLLMDecision` (agent.ts:165–188). `none` = should_call=false / missing service_id / unparseable JSON — the parser **fails closed** to `should_call=false` and ignores extra fields. The parsed `confidence` is never used by any gate |
| `stepB` ladder | Per-agent body of `runTreasuryCycle`, agent.ts:295–612, in the code's exact gate order (below) |
| `execOk s` (abstraction) | Deterministic sub-checks inside `executeServiceCallOnBehalf`, agent.ts:190–281: rows/keys/provider exist, chain balance ≥ amount + gas (205–213), transfer sent (217), `verifyPaymentBeforeDelivery` true (226), DB transaction (251–256) |
| `cycle` / `runCycle` | The per-agent loop; `totalSpentCSPR` is a per-run local starting at 0, incremented **only after a successful execution** (agent.ts:557) |
| `verifyModel` | `verifyPaymentBeforeDelivery`, contracts.ts:384–423 |
| `directCall` | `POST /api/services/[id]/call`, route.ts (whole file, 316 lines) |

### The gate ladder as implemented (per agent, per cycle)

1. **Consideration filter** — LIVE: only `status='active' AND isOnChain`
   agents; dry-run: all active agents (agent.ts:320–327). Modelled as the
   `not_considered` outcome.
2. **Low-balance hard rule** (LIVE only) — `balance < 2 * minBalanceCSPR`
   ⇒ `skip_low_balance`, LLM never consulted (agent.ts:361–380).
3. **Cycle cap screen** — `totalSpentCSPR >= maxSpendPerCycleCSPR`
   ⇒ `no_action`/"cap reached" (agent.ts:384–400). Checked against the
   **pre-spend** total; spend is debited only after success (557).
4. **LLM oracle** — decline / no service_id ⇒ `no_action` (agent.ts:429–478).
5. **Candidate membership** — `services.find(s => s.id === service_id)`,
   miss ⇒ `no_action` (agent.ts:479–501). The candidate list is the
   `status='active'` services, category-filtered only when
   `allowedCategories` is non-empty (agent.ts:329–340).
6. **Dry-run gate** — decision logged `dry_run`, nothing executes
   (agent.ts:504–530).
7. **Execution** — `executeServiceCallOnBehalf`; success ⇒ decision
   `call_service`/`executed`, `totalSpentCSPR += pricePerCall` (agent.ts:533–560);
   exception ⇒ decision `call_service`/`skipped` (agent.ts:572+).

## Theorems

| Theorem | Statement (informal) | Source basis |
|---|---|---|
| `stepB_paid_spec`, `step_paid_spec` | **Master gate theorem.** If a step pays, then: dryRun=false, agent on-chain, `2 * minBalance ≤ balance`, `spent < cap` at check time, the oracle chose candidate `i`, the candidate lookup hit, `execOk` held — and `spent' = spent + s.price` (the DB price). Holds for an **arbitrary** oracle | agent.ts:361, 384, 429–479, 190–281 |
| `stepB_spent_of_not_paid` | Non-paid outcomes never move the spend total | agent.ts:557 (increment on success path only) |
| `stepB_charge`, `step_charge` | The charge contributed by a paid outcome is exactly the chosen candidate's DB price — the oracle has zero influence on the amount | agent.ts:205, 557 |
| `cycle_length` | Exactly one outcome per considered agent per cycle — within one cycle no agent's decision can be executed twice | per-agent loop, agent.ts:295–612 |
| `runCycle_disabled` | `cfg.enabled = false` ⇒ the cycle produces no outcomes and no decisions at all | early return, agent.ts:304–315 |
| `cycle_paid_gates` | For **every** oracle: any `paid` outcome anywhere in a cycle traces to a listed agent that passed all deterministic gates (on-chain, 2× reserve screen, oracle choice in candidate set, execution checks) | whole ladder |
| `cycle_spent` | **Exact accounting:** final cycle total = initial total + Σ DB prices of exactly the paid outcomes. No hidden or lost charges in the model. Gas is *not* in this total — the DB balance is decremented by price only (agent.ts:251–256) while the on-chain purse pays price + gas (agent.ts:205–213) | agent.ts:251–256, 557 |
| `reserve_not_enforced` | **Counterexample (proved).** Balance 11, reserve 5, price 10 passes every deterministic gate and pays, ending at 1 < 5. The post-spend reserve exists only as prompt advice to the LLM ("do NOT spend if it would drop the agent below this", agent.ts:115) | agent.ts:115 vs 361 |
| `cap_single_step_overshoot` | **Counterexample (proved).** Spent 9, cap 10, price 8 ⇒ paid, total 17 > cap. No check that the individual price fits the remaining cap | agent.ts:384, 557 |
| `cap_cycle_overshoot` | **Counterexample (proved).** Two 8-unit calls vs cap 10 both pass (0 < 10, then 8 < 10); cycle ends at 16 > 10. The cap bounds neither single payments nor the cycle total — only the total at the moment each agent is checked | agent.ts:384, 557 |
| `verifyModel_confirmed` | For a confirmed deploy, `verifyPaymentBeforeDelivery` returns verified ⇔ the transfer list is non-empty — amounts and recipient are irrelevant to the outcome | contracts.ts:400–418 |
| `verify_underpaid_still_verified` | **Counterexample (proved).** Confirmed deploy with a single 1-mote transfer verifies against a required amount of 100 | contracts.ts:415–418 (fallback: any transfers at all ⇒ verified) |
| `verify_not_confirmed` | Pending/failed deploys never verify | contracts.ts:388–398 |
| `directCall_onchain_delivered` | Direct call with on-chain agent + sufficient chain balance ⇒ delivered via the on-chain branch | route.ts:99–~210 |
| `directCall_demo_delivered` | Direct call in demo mode with sufficient DB balance ⇒ delivered with a fabricated hash | route.ts:~215–294; `txHash = 0x + randomBytes(32)` at route.ts:247 |
| `directCall_silent_downgrade` | **Counterexample (proved).** Caller requests on-chain payment, agent is not on-chain (or has no key), DB balance suffices ⇒ the request **falls through to the demo branch and is delivered** with a fabricated hash — no error tells the caller the payment was not on-chain | route.ts:99 (branch condition) + fallthrough to demo branch |

## What survives the LLM oracle — and what does not

**Survives (proved for all oracles):** gate order and gating itself; the
charged amount is always the DB `pricePerCall`; spend accounting is exact;
dry-run never executes; a disabled treasury does nothing; within a cycle each
agent is processed at most once.

**Does not survive:** *which* service is bought, whether the spend is
sensible or role-appropriate, the post-spend reserve (prompt-only), and the
cycle cap as a bound on actual spend (screened pre-spend, not enforced).
`execOk` additionally abstracts the chain/RPC layer, whose real
implementation is the weak `verifyModel` above.

## Discrepancies and risks

1. **The cycle cap is a screen, not an enforcement.** Checked against the
   pre-spend total (agent.ts:384), debited only after successful execution
   (agent.ts:557), with no per-payment fit check — proved overshoots above.
   It is also a per-run local variable: nothing cumulative is tracked across
   cycles except the balances themselves, and concurrent cycles would each
   start from 0.
2. **The reserve rule is prompt-deep.** README and prompt present
   `minBalanceCSPR` as a floor the agent will not drop below; the only
   deterministic checks are the pre-call `balance ≥ 2 × minBalance` screen
   and `chainBalance ≥ amount + gas` inside execution. Proved counterexample
   ends below the floor.
3. **`verifyPaymentBeforeDelivery` does not verify the payment.** The
   recipient is cleaned into an unused local (`toClean`, contracts.ts:~405)
   with the comment "for testnet we accept any confirmed transfer"; the
   amount test accepts *any* transfer in the deploy ≥ required; and if no
   transfer matches but the deploy has any transfers at all, it still
   returns verified (contracts.ts:415–418). Proved: a 1-mote transfer
   "verifies" a 100-mote requirement.
4. **Transfer precedes verification; failure is post-payment.** In both the
   treasury (agent.ts:217 → 226) and the direct route (transfer → verify →
   402 `verification_failed`), the deploy is already submitted when
   verification fails. There is no refund/rollback path; the DB rows are
   simply not written (treasury) or a 402 is returned for a payment that
   already moved (direct route).
5. **Direct call route bypasses the treasury's rules entirely.** No
   `status='active'` check on service or agent, no cap, no category
   restriction, no minimum-balance rule, no reserve — only existence
   (404), `agentId` presence (400), and a balance check. Plus the silent
   on-chain→demo downgrade (proved above), after which the response
   reports "Payment verified (demo mode)" (route.ts:294) with a random
   fabricated `txHash` (route.ts:247).
6. **No replay protection and no approval workflow.** v1 has no approval /
   HITL code at all — there is no approval token to replay; the treasury is
   fully autonomous once enabled. `Payment.requestId` is
   `String @default("")` with **no `@unique`** (schema.prisma:61), so the DB
   enforces nothing; the treasury requestId
   (`` `treasury-${cycleId.slice(0,8)}-${agent.id.slice(0,6)}` ``,
   agent.ts:532) is unique only by cycle-UUID convention. Re-running or
   concurrently running cycles can pay the same agent+service again; the
   only real limiters are the balances. The proved guarantee is narrower:
   one outcome per agent *within* a single cycle run (`cycle_length`).
7. **Unauthenticated treasury trigger with a persistent "transient"
   override.** `POST /api/treasury/run` has no auth check. Its comment says
   the `dryRun` body flag is applied "transiently (without persisting)"
   (route.ts:10), but the code calls `updateTreasuryConfig({ dryRun })`
   (route.ts:13), which **writes it to the DB** — one unauthenticated POST
   can persistently flip the treasury between live and dry-run, or trigger
   a live cycle. Service `apiKey`s are generated at registration but never
   checked anywhere (no middleware exists).
8. **README vs code — decision logging.** README step 7: "a
   TreasuryDecision row is created for every agent on every cycle."
   Code: disabled treasury ⇒ no rows (early return); agents filtered out
   by the consideration query ⇒ no rows; per-agent exceptions caught by
   the outer handler are appended to `errors[]` with **no** decision row.
   (README steps 1–6 match the code, including the 2× rule and the
   dry-run agent set.)
9. **Float money.** Balances/caps are IEEE-754 doubles in CSPR units while
   the model (and the on-chain layer) uses exact integers; comparisons like
   `balanceCSPR < minBalanceCSPR * 2` can round at boundaries the model
   treats as exact. The Lean results should be read as order/safety
   properties of the logic, not of the float arithmetic.
10. **Dead signal.** The LLM's `confidence` is parsed, stored, and never
    consulted by any gate — a low-confidence "call" pays exactly like a
    high-confidence one.
