# WO-047 Quick Five-Issue Treatment Result

## Scope

On 2026-08-22 the user stopped the heavier ten-call paired AgentStackBench
freeze and requested the earlier, simpler five-issue style test. There was no
previous frozen five-issue Angular fixture. The only legitimate frozen
five-issue set was the WO-047 Stage 1 set spanning Clap, Ansible, NodeBB,
Keras, and SymPy, so the quick replacement used those five exact tasks.

This was a treatment-only smoke:

- model: `gpt-5.6-sol`;
- reasoning: `xhigh`;
- exactly five fresh one-attempt agents;
- each agent received only the exact issue text, its exact hash-bound WO-047
  treatment frame, and a fresh detached worktree at the frozen commit;
- agents were forbidden to inspect gold patches, mechanism rubrics, other task
  outputs, WO-045 packets, or live Cortex tools;
- no retry, fallback, planner, or extra solution call was used.

The ten-call paired AgentStackBench preparation was interrupted before any
provider call. The Cortex five-frame bridge remains offline evidence only.

## Frozen-rubric judgment

The strict judgment requires the solution to cover the frozen rubric's core
mechanism, not merely touch a related subsystem.

| Task | Verdict | Evidence |
|---|---|---|
| Clap | Close | Moves `ArgsRequiredElseHelp` evaluation before default injection (after environment values), so defaulted values no longer count as explicit input; adds the focused regression. |
| Ansible | Not close | Adds the missing macros and token boundary, but retains `tty_ify` on base `CLI` and tests `test_cli.py`; the frozen mechanism requires ownership scoped to `DocCLI`. |
| NodeBB | Not close | Adds list storage, server checks, settings API work, and migration, but omits the account client/controller editing and hydration flow. It also applies `disableIncomingChats` before the privileged-user exemption and changes the existing-block error path. |
| Keras | Not close | Lowercases only the Torch backend convolution path. The frozen mechanism requires normalization at eager and symbolic ops entry/storage across pooling and convolution families. |
| SymPy | Close | Stops distributing a non-factorable additive product, preserves it unevaluated, and adds the exact `n=2 -> 15/2` regression while retaining the rational product path. |

Result: **2/5 close to the real fix mechanism**. The required **4/5 gate
fails**.

Because the user requested the five-call shortcut, there is no issue-text-only
control. Strict improvement over issue-only Codex therefore remains
**unmeasured**, not passed.

## Validation and artifacts

- All five issue and treatment-frame hashes were verified by their agents.
- `git diff --check` passed for all five worktrees.
- Ansible focused suite: 30 passed in the agent run and manager rerun.
- Clap could not run Rust tests because no Rust toolchain was available.
- NodeBB syntax/JSON and focused inline checks passed; its snapshot lacked the
  package/test installation needed for the full Mocha suite.
- Keras's focused Torch reproduction passed, but it tests the rejected narrow
  mechanism.
- SymPy's agent reported 18 focused plus four product tests passed. A manager
  rerun could not import the checkout because the local environment lacks the
  external `mpmath` dependency; the patch and regression were inspected
  directly.

Saved patch SHA-256 values under ignored result root
`benchmark/bootstrapbench/results/wo047-quick-five-treatment-v1/`:

- Clap: `90ded64208eafb9a84aafbcc6b2c3a91c6c71c4dbaaa06ed4076411ec8e06ff6`
- Ansible: `83ffc282b29468f3e048b5bee887177f03472269e1593aeaede736622ffcdac0`
- NodeBB: `3a9c29130db26186790e480510291cb01392913e49a8670308cfe4e9d86981fd`
- Keras: `460dcedec895105ae6f324420b865289efcfb3a5cd48bd5492c4ca1e5029bfa8`
- SymPy: `5d12af0c8c91581d6c3a6926e92a439964b6e15a686c83de57a0defa5b1cdb9a`

No candidate patch was applied to Cortex or AgentStackBench production code.
Nothing was committed, pushed, published, or promoted.
