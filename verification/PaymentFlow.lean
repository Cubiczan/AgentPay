/-
  AgentPay (v1) — Lean 4 formal model of the payment decision pipeline.

  Sources modelled (see verification/NOTES.md for the full mapping):
  * `src/lib/treasury/agent.ts` — `runTreasuryCycle` (the per-agent gate
    ladder) and `executeServiceCallOnBehalf` (the execution sub-checks).
  * `src/lib/casper/contracts.ts` — `verifyPaymentBeforeDelivery`.
  * `src/app/api/services/[id]/call/route.ts` — the direct call route
    (on-chain branch and demo branch).

  Amounts are modelled in `Nat` in a single abstract unit. In the code
  the treasury compares CSPR-denominated floats for the gates and motes
  (BigInt) inside execution; the model abstracts the unit away, which is
  sound for the *order/safety* properties proved here but not for
  float-rounding behaviour (flagged in NOTES.md).

  The LLM is modelled as an ARBITRARY oracle: it maps the agent's balance
  to `none` (decline / unparseable) or `some i` (call candidate `i`).
  Every theorem is universally quantified over the oracle, so the proved
  guarantees hold for *every* possible LLM behaviour. The oracle cannot
  choose the amount: the charged amount is always the DB price of the
  chosen candidate (agent.ts:205, 557).

  Lean 4.34.1, core library only. No `sorry` / `admit` / custom axioms.
-/

namespace AgentPay

/-! ## Treasury cycle: configuration, inputs, outcomes -/

/-- Treasury configuration (schema.prisma `TreasuryConfig`;
    agent.ts `getTreasuryConfig`/`updateTreasuryConfig`). -/
structure Cfg where
  enabled : Bool
  dryRun : Bool
  /-- `minBalanceCSPR` — reserve per agent. -/
  minBalance : Nat
  /-- `maxSpendPerCycleCSPR` — per-cycle spend cap. -/
  cap : Nat

/-- A candidate service. Only the price matters for the gates; the price
    always comes from the DB row, never from the LLM. -/
structure Service where
  price : Nat

/-- Per-agent input to a cycle: on-chain status and (refreshed) balance.
    agent.ts:320-327. -/
structure AgentIn where
  onChain : Bool
  balance : Nat

/-- The LLM oracle: balance ↦ chosen candidate index, or `none` for
    "should_call = false", a missing service_id, or an unparseable
    response (parseLLMDecision fails closed to should_call=false,
    agent.ts:165-188). -/
def Oracle := Nat → Option Nat

/-- Outcome of processing one agent. `paid` = a Payment row was created
    and the agent debited; `dryRun` = decision logged only. -/
inductive Outcome where
  | paid (idx : Nat)
  | dryRun (idx : Nat)
  | skipped (why : String)
deriving DecidableEq, Repr

/-- Positional lookup into the candidate list. The code finds the
    oracle-chosen service by id in the candidate array
    (agent.ts:479); the model abstracts service ids to positions,
    which preserves exactly the "chosen id must be in the candidate
    set" check. (Defined locally: `List.get?` is not in the core
    prelude.) -/
def lookup : List Service → Nat → Option Service
  | [], _ => none
  | s :: _, 0 => some s
  | _ :: rest, n + 1 => lookup rest n

/-! ## The per-agent gate ladder -/

/-- One step of the treasury cycle for one agent, in the code's exact
    gate order (agent.ts `runTreasuryCycle`). All fields are free
    variables here; `step` below instantiates them from `Cfg`/`AgentIn`.

    1. LIVE-mode consideration filter: non-on-chain agents are not
       considered at all (320-327). In dry-run all active agents are.
    2. Low-balance hard rule, LIVE only: `balance < 2 * minBalance`
       skips *without* consulting the LLM (361-380).
    3. Cycle spend cap: `spent ≥ cap` defers the agent (384-400).
       NOTE: checked *before* the agent's spend, and spend is added
       only *after* a successful execution (557) — the cap gates
       the pre-spend total, it does not bound the final total.
    4. The LLM oracle decides (429-454); decline ⇒ skip (456-478).
    5. The chosen id must be in the candidate set (479-501).
    6. Dry-run gate: log only, never execute (504-530).
    7. Execution sub-checks, abstracted as `execOk`.

    `execOk s` abstracts the conjunction of the deterministic checks
    inside `executeServiceCallOnBehalf` (agent.ts:190-281): agent and
    service rows exist, agent has Ed25519 keys, service has a provider
    address, on-chain balance ≥ amount + gas, and
    `verifyPaymentBeforeDelivery` returned true (on the weakness of
    that last check, see the `verifyModel` section below). If any
    fails, the call throws; the decision is logged `skipped`, no
    Payment row is created and `spent` is not incremented (621-690). -/
def stepB (dryRun onChain : Bool) (balance minBalance cap spent : Nat)
    (cands : List Service) (oracle : Oracle) (execOk : Service → Bool) :
    Outcome × Nat :=
  if dryRun = false ∧ onChain = false then
    (Outcome.skipped "not_considered", spent)
  else if dryRun = false ∧ balance < 2 * minBalance then
    (Outcome.skipped "low_balance", spent)
  else if cap ≤ spent then
    (Outcome.skipped "cap_reached", spent)
  else
    match oracle balance with
    | none => (Outcome.skipped "declined", spent)
    | some i =>
      match lookup cands i with
      | none => (Outcome.skipped "unknown_service", spent)
      | some s =>
        if dryRun = true then (Outcome.dryRun i, spent)
        else if execOk s = true then (Outcome.paid i, spent + s.price)
        else (Outcome.skipped "execution_failed", spent)

/-- `stepB` instantiated from the config / agent records, as in the
    code. -/
def step (cfg : Cfg) (a : AgentIn) (cands : List Service) (spent : Nat)
    (oracle : Oracle) (execOk : Service → Bool) : Outcome × Nat :=
  stepB cfg.dryRun a.onChain a.balance cfg.minBalance cfg.cap spent
    cands oracle execOk

/-- **Master gate theorem.** If a step pays, then every deterministic
    gate before execution passed, in the code's order: the run is LIVE,
    the agent is on-chain, the balance cleared the 2×-reserve rule, the
    cycle cap was still open at check time, the oracle chose candidate
    `i` from the candidate set, and the execution sub-checks held. The
    charged amount is exactly the DB price of the chosen candidate —
    the oracle has no influence on the amount. Holds for an ARBITRARY
    oracle. -/
theorem stepB_paid_spec {dryRun onChain : Bool}
    {balance minBalance cap spent : Nat} {cands : List Service}
    {oracle : Oracle} {execOk : Service → Bool} {i spent' : Nat}
    (h : stepB dryRun onChain balance minBalance cap spent cands oracle
      execOk = (Outcome.paid i, spent')) :
    dryRun = false ∧ onChain = true ∧ 2 * minBalance ≤ balance ∧
    spent < cap ∧
    ∃ s, oracle balance = some i ∧ lookup cands i = some s ∧
      execOk s = true ∧ spent' = spent + s.price := by
  by_cases h1 : dryRun = false ∧ onChain = false
  · have hstep : stepB dryRun onChain balance minBalance cap spent cands
        oracle execOk = (Outcome.skipped "not_considered", spent) := by
      simp [stepB, h1.1, h1.2]
    rw [hstep] at h; simp at h
  by_cases h2 : dryRun = false ∧ balance < 2 * minBalance
  · have hnon : ¬(onChain = false) := fun hoc => h1 ⟨h2.1, hoc⟩
    have hstep : stepB dryRun onChain balance minBalance cap spent cands
        oracle execOk = (Outcome.skipped "low_balance", spent) := by
      simp [stepB, h2.1, hnon, h2.2]
    rw [hstep] at h; simp at h
  by_cases h3 : cap ≤ spent
  · have hstep : stepB dryRun onChain balance minBalance cap spent cands
        oracle execOk = (Outcome.skipped "cap_reached", spent) := by
      simp [stepB, h1, h2, h3]
    rw [hstep] at h; simp at h
  cases ho : oracle balance with
  | none =>
    have hstep : stepB dryRun onChain balance minBalance cap spent cands
        oracle execOk = (Outcome.skipped "declined", spent) := by
      simp [stepB, h1, h2, h3, ho]
    rw [hstep] at h; simp at h
  | some i₀ =>
    cases hg : lookup cands i₀ with
    | none =>
      have hstep : stepB dryRun onChain balance minBalance cap spent
          cands oracle execOk =
          (Outcome.skipped "unknown_service", spent) := by
        simp [stepB, h1, h2, h3, ho, hg]
      rw [hstep] at h; simp at h
    | some s =>
      by_cases h4 : dryRun = true
      · have hstep : stepB dryRun onChain balance minBalance cap spent
            cands oracle execOk = (Outcome.dryRun i₀, spent) := by
          simp [stepB, h3, ho, hg, h4]
        rw [hstep] at h; simp at h
      have hdry : dryRun = false := by
        cases dryRun with
        | false => rfl
        | true => exact absurd rfl h4
      have hon : onChain = true := by
        cases onChain with
        | true => rfl
        | false => exact absurd ⟨hdry, rfl⟩ h1
      have hnb : ¬ balance < 2 * minBalance :=
        fun hb => h2 ⟨hdry, hb⟩
      by_cases h5 : execOk s = true
      · have hstep : stepB dryRun onChain balance minBalance cap spent
            cands oracle execOk =
            (Outcome.paid i₀, spent + s.price) := by
          simp [stepB, hdry, hon, hnb, h3, ho, hg, h5]
        rw [hstep] at h
        simp only [Prod.mk.injEq, Outcome.paid.injEq] at h
        obtain ⟨hi, hsp⟩ := h
        subst hi
        have hbal : 2 * minBalance ≤ balance := by omega
        have hcap : spent < cap := by omega
        exact ⟨hdry, hon, hbal, hcap, ⟨s, rfl, hg, h5, hsp.symm⟩⟩
      · have hstep : stepB dryRun onChain balance minBalance cap spent
            cands oracle execOk =
            (Outcome.skipped "execution_failed", spent) := by
          simp [stepB, hdry, hon, hnb, h3, ho, hg, h5]
        rw [hstep] at h; simp at h

/-- `stepB_paid_spec` at the `Cfg`/`AgentIn` level. -/
theorem step_paid_spec {cfg : Cfg} {a : AgentIn} {cands : List Service}
    {spent : Nat} {oracle : Oracle} {execOk : Service → Bool}
    {i spent' : Nat}
    (h : step cfg a cands spent oracle execOk =
      (Outcome.paid i, spent')) :
    cfg.dryRun = false ∧ a.onChain = true ∧
    2 * cfg.minBalance ≤ a.balance ∧ spent < cfg.cap ∧
    ∃ s, oracle a.balance = some i ∧ lookup cands i = some s ∧
      execOk s = true ∧ spent' = spent + s.price := by
  have h' : stepB cfg.dryRun a.onChain a.balance cfg.minBalance cfg.cap
      spent cands oracle execOk = (Outcome.paid i, spent') := h
  exact stepB_paid_spec h'

/-- The charge a single outcome contributes to the cycle spend total:
    the DB price of the paid candidate, 0 for anything else. -/
def chargeOf (cands : List Service) : Outcome → Nat
  | Outcome.paid i => match lookup cands i with
    | some s => s.price
    | none => 0
  | _ => 0

/-- Non-payment outcomes never move the spend total: in the code,
    `totalSpentCSPR` is incremented only after a successful execution
    (agent.ts:557), and every skip/dry-run path leaves it alone. -/
theorem stepB_spent_of_not_paid {dryRun onChain : Bool}
    {balance minBalance cap spent : Nat} {cands : List Service}
    {oracle : Oracle} {execOk : Service → Bool} {o : Outcome}
    {spent' : Nat}
    (h : stepB dryRun onChain balance minBalance cap spent cands oracle
      execOk = (o, spent'))
    (hnp : ∀ i, o ≠ Outcome.paid i) :
    spent' = spent := by
  by_cases h1 : dryRun = false ∧ onChain = false
  · have hstep : stepB dryRun onChain balance minBalance cap spent cands
        oracle execOk = (Outcome.skipped "not_considered", spent) := by
      simp [stepB, h1.1, h1.2]
    rw [hstep] at h
    simp only [Prod.mk.injEq] at h
    exact h.2.symm
  by_cases h2 : dryRun = false ∧ balance < 2 * minBalance
  · have hnon : ¬(onChain = false) := fun hoc => h1 ⟨h2.1, hoc⟩
    have hstep : stepB dryRun onChain balance minBalance cap spent cands
        oracle execOk = (Outcome.skipped "low_balance", spent) := by
      simp [stepB, h2.1, hnon, h2.2]
    rw [hstep] at h
    simp only [Prod.mk.injEq] at h
    exact h.2.symm
  by_cases h3 : cap ≤ spent
  · have hstep : stepB dryRun onChain balance minBalance cap spent cands
        oracle execOk = (Outcome.skipped "cap_reached", spent) := by
      simp [stepB, h1, h2, h3]
    rw [hstep] at h
    simp only [Prod.mk.injEq] at h
    exact h.2.symm
  cases ho : oracle balance with
  | none =>
    have hstep : stepB dryRun onChain balance minBalance cap spent cands
        oracle execOk = (Outcome.skipped "declined", spent) := by
      simp [stepB, h1, h2, h3, ho]
    rw [hstep] at h
    simp only [Prod.mk.injEq] at h
    exact h.2.symm
  | some i₀ =>
    cases hg : lookup cands i₀ with
    | none =>
      have hstep : stepB dryRun onChain balance minBalance cap spent
          cands oracle execOk =
          (Outcome.skipped "unknown_service", spent) := by
        simp [stepB, h1, h2, h3, ho, hg]
      rw [hstep] at h
      simp only [Prod.mk.injEq] at h
      exact h.2.symm
    | some s =>
      by_cases h4 : dryRun = true
      · have hstep : stepB dryRun onChain balance minBalance cap spent
            cands oracle execOk = (Outcome.dryRun i₀, spent) := by
          simp [stepB, h3, ho, hg, h4]
        rw [hstep] at h
        simp only [Prod.mk.injEq] at h
        exact h.2.symm
      have hdry : dryRun = false := by
        cases dryRun with
        | false => rfl
        | true => exact absurd rfl h4
      have hon : onChain = true := by
        cases onChain with
        | true => rfl
        | false => exact absurd ⟨hdry, rfl⟩ h1
      have hnb : ¬ balance < 2 * minBalance :=
        fun hb => h2 ⟨hdry, hb⟩
      by_cases h5 : execOk s = true
      · have hstep : stepB dryRun onChain balance minBalance cap spent
            cands oracle execOk =
            (Outcome.paid i₀, spent + s.price) := by
          simp [stepB, hdry, hon, hnb, h3, ho, hg, h5]
        rw [hstep] at h
        simp only [Prod.mk.injEq] at h
        exact absurd h.1.symm (hnp i₀)
      · have hstep : stepB dryRun onChain balance minBalance cap spent
            cands oracle execOk =
            (Outcome.skipped "execution_failed", spent) := by
          simp [stepB, hdry, hon, hnb, h3, ho, hg, h5]
        rw [hstep] at h
        simp only [Prod.mk.injEq] at h
        exact h.2.symm

/-- Spend accounting for one step: the new spent total is the old one
    plus exactly the charge of the produced outcome. -/
theorem stepB_charge {dryRun onChain : Bool}
    {balance minBalance cap spent : Nat} {cands : List Service}
    {oracle : Oracle} {execOk : Service → Bool} {o : Outcome}
    {spent' : Nat}
    (h : stepB dryRun onChain balance minBalance cap spent cands oracle
      execOk = (o, spent')) :
    spent' = spent + chargeOf cands o := by
  cases o with
  | skipped why =>
    have hsp := stepB_spent_of_not_paid h (fun i hcon => by cases hcon)
    rw [hsp]; simp [chargeOf]
  | dryRun j =>
    have hsp := stepB_spent_of_not_paid h (fun i hcon => by cases hcon)
    rw [hsp]; simp [chargeOf]
  | paid j =>
    have spec := stepB_paid_spec h
    obtain ⟨_, _, _, _, s, _, hg, _, hsp⟩ := spec
    rw [hsp]; simp [chargeOf, hg]

/-- `stepB_charge` at the `Cfg`/`AgentIn` level. -/
theorem step_charge {cfg : Cfg} {a : AgentIn} {cands : List Service}
    {spent : Nat} {oracle : Oracle} {execOk : Service → Bool}
    {o : Outcome} {spent' : Nat}
    (h : step cfg a cands spent oracle execOk = (o, spent')) :
    spent' = spent + chargeOf cands o := by
  have h' : stepB cfg.dryRun a.onChain a.balance cfg.minBalance cfg.cap
      spent cands oracle execOk = (o, spent') := h
  exact stepB_charge h'

/-! ## The cycle -/

/-- One treasury cycle over a list of agents, threading the spend
    total. Mirrors the `for` loop in `runTreasuryCycle`
    (agent.ts:295-612): one outcome per agent, in order. -/
def cycle (cfg : Cfg) (cands : List Service) (oracle : Oracle)
    (execOk : Service → Bool) : List AgentIn → Nat → List Outcome × Nat
  | [], spent => ([], spent)
  | a :: rest, spent =>
    let s := step cfg a cands spent oracle execOk
    let r := cycle cfg cands oracle execOk rest s.2
    (s.1 :: r.1, r.2)

theorem cycle_cons (cfg : Cfg) (cands : List Service) (oracle : Oracle)
    (execOk : Service → Bool) (a : AgentIn) (rest : List AgentIn)
    (spent : Nat) :
    cycle cfg cands oracle execOk (a :: rest) spent =
      ((step cfg a cands spent oracle execOk).1 ::
        (cycle cfg cands oracle execOk rest
          (step cfg a cands spent oracle execOk).2).1,
       (cycle cfg cands oracle execOk rest
          (step cfg a cands spent oracle execOk).2).2) := rfl

/-- The whole run, including the master `enabled` switch
    (agent.ts:304-315): a disabled treasury produces no decisions and
    no spend at all. -/
def runCycle (cfg : Cfg) (agents : List AgentIn) (cands : List Service)
    (oracle : Oracle) (execOk : Service → Bool) : List Outcome × Nat :=
  if cfg.enabled = false then ([], 0)
  else cycle cfg cands oracle execOk agents 0

theorem runCycle_disabled (cfg : Cfg) (agents : List AgentIn)
    (cands : List Service) (oracle : Oracle) (execOk : Service → Bool)
    (h : cfg.enabled = false) :
    runCycle cfg agents cands oracle execOk = ([], 0) := by
  simp [runCycle, h]

/-- Exactly one outcome per agent per cycle — the structural fact
    behind "no replay within a cycle": an agent's decision is produced
    by exactly one `step` invocation, and execution happens inline in
    that same invocation, not by consuming a stored approval later.
    Combined with `cycle_paid_gates`, each agent can contribute at
    most one payment per cycle. -/
theorem cycle_length (cfg : Cfg) (cands : List Service) (oracle : Oracle)
    (execOk : Service → Bool) :
    ∀ (agents : List AgentIn) (spent : Nat),
      (cycle cfg cands oracle execOk agents spent).1.length =
        agents.length := by
  intro agents
  induction agents with
  | nil => intro spent; rfl
  | cons a rest ih =>
    intro spent
    rw [cycle_cons]
    cases hstep : step cfg a cands spent oracle execOk with
    | mk o spent₁ =>
      show (o :: (cycle cfg cands oracle execOk rest spent₁).1).length =
        (a :: rest).length
      rw [List.length_cons, List.length_cons, ih spent₁]

/-- **Payment implies all prior checks passed** (whole cycle). For an
    ARBITRARY oracle: any `paid` outcome anywhere in a cycle traces
    back to an agent in the input list that was considered in LIVE
    mode, was on-chain, cleared the 2×-reserve rule, was chosen by the
    oracle from the candidate set, and passed the execution
    sub-checks. No later stage — in particular not the LLM — can
    bypass an earlier gate. -/
theorem cycle_paid_gates (cfg : Cfg) (cands : List Service)
    (oracle : Oracle) (execOk : Service → Bool) :
    ∀ (agents : List AgentIn) (spent : Nat) (i : Nat),
      Outcome.paid i ∈ (cycle cfg cands oracle execOk agents spent).1 →
      cfg.dryRun = false ∧
      ∃ a ∈ agents, a.onChain = true ∧
        2 * cfg.minBalance ≤ a.balance ∧
        ∃ s, oracle a.balance = some i ∧ lookup cands i = some s ∧
          execOk s = true := by
  intro agents
  induction agents with
  | nil => intro spent i hi; simp [cycle] at hi
  | cons a rest ih =>
    intro spent i hi
    rw [cycle_cons] at hi
    cases hstep : step cfg a cands spent oracle execOk with
    | mk o spent₁ =>
      simp only [hstep] at hi
      cases o with
      | skipped why =>
        simp only [List.mem_cons] at hi
        cases hi with
        | inl heq => cases heq
        | inr hmem =>
          obtain ⟨hdry, a', ha', hq⟩ := ih spent₁ i hmem
          exact ⟨hdry, a', List.mem_cons_of_mem a ha', hq⟩
      | dryRun j =>
        simp only [List.mem_cons] at hi
        cases hi with
        | inl heq => cases heq
        | inr hmem =>
          obtain ⟨hdry, a', ha', hq⟩ := ih spent₁ i hmem
          exact ⟨hdry, a', List.mem_cons_of_mem a ha', hq⟩
      | paid j =>
        simp only [List.mem_cons] at hi
        cases hi with
        | inl heq =>
          have hj : i = j := Outcome.paid.inj heq
          subst hj
          have spec := step_paid_spec hstep
          obtain ⟨s, hor, hlk, hex, -⟩ := spec.2.2.2.2
          exact ⟨spec.1, a, List.mem_cons_self, spec.2.1, spec.2.2.1,
            s, hor, hlk, hex⟩
        | inr hmem =>
          obtain ⟨hdry, a', ha', hq⟩ := ih spent₁ i hmem
          exact ⟨hdry, a', List.mem_cons_of_mem a ha', hq⟩

/-- Total charged by a list of outcomes. -/
def paidTotal (cands : List Service) : List Outcome → Nat
  | [] => 0
  | o :: rest => chargeOf cands o + paidTotal cands rest

/-- **Exact spend accounting.** The cycle's final spend total equals
    the initial total plus the sum of the DB prices of exactly the
    paid outcomes — no hidden charges, no lost charges, in the model.
    (The gas stipend is *not* part of this total in the code either:
    the DB balance is decremented by price only, agent.ts:251-256,
    while the on-chain purse pays price + gas — see NOTES.md.) -/
theorem cycle_spent (cfg : Cfg) (cands : List Service) (oracle : Oracle)
    (execOk : Service → Bool) :
    ∀ (agents : List AgentIn) (spent : Nat),
      (cycle cfg cands oracle execOk agents spent).2 =
        spent + paidTotal cands
          (cycle cfg cands oracle execOk agents spent).1 := by
  intro agents
  induction agents with
  | nil => intro spent; simp [cycle, paidTotal]
  | cons a rest ih =>
    intro spent
    rw [cycle_cons]
    cases hstep : step cfg a cands spent oracle execOk with
    | mk o spent₁ =>
      have hcharge := step_charge hstep
      have ih' := ih spent₁
      rw [ih', hcharge]
      simp [paidTotal]
      omega

/-! ## Negative results: guarantees the code does NOT provide

    The next three results are proved *counterexamples* — concrete
    executions of the model (hence of the code's ladder) that violate
    properties the documentation appears to promise. -/

/-- The system prompt tells the LLM "do NOT spend if it would drop the
    agent below this [minBalance]" (agent.ts:115), and the README
    repeats the reserve as a protective rule. But no deterministic
    check enforces a post-spend reserve: the only balance gates are
    `balance ≥ 2 * minBalance` before the call and
    `chainBalance ≥ amount + gas` inside execution. An agent with
    balance 11, reserve 5 and a 10-unit service passes every
    deterministic gate and ends at 1 — below the reserve. The reserve
    survives only as advice to the oracle. -/
theorem reserve_not_enforced :
    (step ⟨true, false, 5, 100⟩ ⟨true, 11⟩ [⟨10⟩] 0 (fun _ => some 0)
      (fun _ => true)).1 = Outcome.paid 0 ∧ 11 - 10 < 5 := by
  decide

/-- The cycle cap is checked against the *pre-spend* total
    (agent.ts:384) and the spend is added *after* execution
    (agent.ts:557), with no check that the individual price fits
    the remaining cap. A single call can overshoot: spent 9, cap 10,
    price 8 pays and lands at 17. -/
theorem cap_single_step_overshoot :
    (step ⟨true, false, 0, 10⟩ ⟨true, 100⟩ [⟨8⟩] 9 (fun _ => some 0)
      (fun _ => true)) = (Outcome.paid 0, 17) ∧ 10 < 17 := by
  decide

/-- Consequently the final cycle total can exceed the cap: two 8-unit
    calls against a cap of 10 both pass the gate (0 < 10, then 8 < 10)
    and the cycle ends at 16 > 10. The cap bounds neither individual
    payments nor the cycle total — only the total *at the moment each
    agent is considered*. -/
theorem cap_cycle_overshoot :
    (cycle ⟨true, false, 0, 10⟩ [⟨8⟩] (fun _ => some 0) (fun _ => true)
      [⟨true, 100⟩, ⟨true, 100⟩] 0).2 = 16 ∧ 10 < 16 := by
  decide

/-! ## `verifyPaymentBeforeDelivery` (contracts.ts:384-423)

    The code polls the deploy status; on `confirmed` it looks for a
    transfer with `amount ≥ requiredAmount` — but the recipient is
    never actually compared: `t.to` is cleaned into a local variable
    that the predicate does not use (contracts.ts:405-409). Worse, if
    no transfer matches, a confirmed deploy with *any* transfer at all
    is accepted (contracts.ts:415-418). We model the transfer list by
    its amounts only — the recipient is not an input, because the code
    effectively ignores it. -/

inductive DeployStatus where
  | pending
  | failed
  | confirmed
deriving DecidableEq, Repr

/-- Faithful model of `verifyPaymentBeforeDelivery`: `amounts` are the
    amounts of the deploy's transfers, `required` the required amount.
    The recipient does not appear — see the section comment. -/
def verifyModel (status : DeployStatus) (amounts : List Nat)
    (required : Nat) : Bool :=
  match status with
  | .confirmed => (amounts.any fun t => required ≤ t) || !amounts.isEmpty
  | _ => false

/-- On a confirmed deploy, verification succeeds **iff there is at
    least one transfer** — the amounts, and hence the required amount,
    are irrelevant. -/
theorem verifyModel_confirmed (amounts : List Nat) (required : Nat) :
    verifyModel .confirmed amounts required = !amounts.isEmpty := by
  cases amounts with
  | nil => rfl
  | cons a rest => simp [verifyModel]

/-- A confirmed deploy whose only transfer is 1 unit verifies against
    a requirement of 100. (And by `verifyModel_confirmed`, a transfer
    to the wrong recipient verifies too — the model has no recipient
    input precisely because the code never checks it.) -/
theorem verify_underpaid_still_verified :
    verifyModel .confirmed [1] 100 = true := rfl

/-- Pending and failed deploys never verify. -/
theorem verify_not_confirmed {status : DeployStatus}
    (h : status ≠ .confirmed) (amounts : List Nat) (required : Nat) :
    verifyModel status amounts required = false := by
  cases status with
  | pending => rfl
  | failed => rfl
  | confirmed => exact absurd rfl h

/-! ## The direct call route (src/app/api/services/[id]/call/route.ts)

    A second, independent payment path. Checks, in order:
    * `agentId` present (106-111), service exists (113-116), agent
      exists (118-121).
    * ON-CHAIN branch, entered iff the caller asked for it AND the
      agent is on-chain with a key (line 140): chain balance ≥
      price + gas (144-158), transfer (161-168), then
      `verifyPaymentBeforeDelivery` must pass before delivery and
      record creation (171-187).
    * DEMO branch — also taken when on-chain was requested but the
      agent is not on-chain (silent downgrade): the only check is
      `agent.balance ≥ price` on the DB ledger (243-252); a random
      txHash is fabricated and the payment is recorded `completed`
      (254-283).
    Neither branch checks that the service or the agent is `active`
    (the treasury candidate queries do filter on status; this route
    does not). -/

inductive CallResult where
  | delivered
  | rejected
deriving DecidableEq, Repr

/-- `gas` is the fixed 0.1 CSPR stipend (route.ts:105), in the same
    abstract unit as `price`; the code converts the price to motes via
    `cspRToMotes` before comparing against the motes balance. -/
def directCall (onChainReq isOnChain hasKey : Bool)
    (dbBal chainBal price gas : Nat) (verified : Bool) : CallResult :=
  if onChainReq = true ∧ isOnChain = true ∧ hasKey = true then
    if price + gas ≤ chainBal ∧ verified = true then .delivered
    else .rejected
  else
    if price ≤ dbBal then .delivered else .rejected

/-- In the on-chain branch, delivery implies the chain-balance check
    and the verification both passed. -/
theorem directCall_onchain_delivered {dbBal chainBal price gas : Nat}
    {verified : Bool}
    (h : directCall true true true dbBal chainBal price gas verified =
      .delivered) :
    price + gas ≤ chainBal ∧ verified = true := by
  unfold directCall at h
  rw [if_pos ⟨rfl, rfl, rfl⟩] at h
  by_cases hc : price + gas ≤ chainBal ∧ verified = true
  · rw [if_pos hc] at h; exact hc
  · rw [if_neg hc] at h; cases h

/-- Outside the on-chain branch, delivery is decided by the DB
    balance alone — no chain state and no verification are involved. -/
theorem directCall_demo_delivered {onChainReq isOnChain hasKey : Bool}
    (hbranch : ¬(onChainReq = true ∧ isOnChain = true ∧ hasKey = true))
    {dbBal chainBal price gas : Nat} {verified : Bool} :
    (directCall onChainReq isOnChain hasKey dbBal chainBal price gas
      verified = .delivered) ↔ price ≤ dbBal := by
  unfold directCall
  rw [if_neg hbranch]
  constructor
  · intro h
    by_cases hp : price ≤ dbBal
    · exact hp
    · rw [if_neg hp] at h; cases h
  · intro hp; rw [if_pos hp]

/-- **Silent downgrade.** A caller explicitly requesting an on-chain
    payment for an agent that is not on-chain gets a `delivered`
    result — a fabricated txHash and a `completed` Payment row in the
    code — with no on-chain transfer and no verification, purely on
    the strength of the DB balance. The response does disclose
    `onChain: false`, but the payment itself succeeds. -/
theorem directCall_silent_downgrade :
    directCall true false true 100 0 50 10 false = .delivered := by
  decide

end AgentPay
