# WO-061 Maintained Analysis State — Current-State Projection Result

## Result

Implementation GO for the Packet 075 acceptance gate. The feature adds one
literal-opt-in, read-only internal API:

```text
renderTrustedAnalysisCurrentState({ enabled: true, cwd, taskId })
```

It reads one already trusted generation through `readTrustedAnalysisState`,
projects that exact state through the accepted query/proof APIs, and returns
schema version 1 with generator `maintained-analysis-current-state-v1`. It does
not add CLI or MCP grammar and does not write or repair state.

## Frozen Byte-Exact Example

The one-blocker fixture returns five decision rows, one blocker, zero
contradictions, one fact proof, and one observation/source-hash proof pair.
Its exact Markdown bytes are:

```markdown
## Current State — `WO-TEST`

- Repository: `cortex`
- Task: `wo061-test`
- Primary subject: `WO-TEST`
- Generation: `1`
- Snapshot SHA-256: `2bf788bdbcb90ed0e3fec6a881b02ef3c574b80f6a1e66690c68da99367c020d`
- Authority bundle SHA-256: `71a4e884e08819f1ca3e34a16d5fc715fb8df81d7229607a47f87ae711a3bb89`

### Decisions

- `accepted`: not derivable
- `review_ready`: not derivable
- `work_order_inputs_viable`: not derivable
- `evidence_trusted`: not derivable
- `required_reviews_go`: not derivable

### Active blockers (1)

- `review_blocker`; fact `fact:4202b5b8045e9b2791a1fcd7b233e985b21c14545238e76f0940f3e611f3d869`; observations `obs:f0247b4f3fc0634ee85eb66a105c462a6d2d0d127893fe97ec64557b8b8e4270` @ `aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa`

### Contradictions (0)

- None.
```

The bytes end in exactly one LF and bind to SHA-256
`c7109b52e4d8b4002aa9cfb15cc0f0e4cf21329b4e61ad6efbb7eca0ee2f15ca`.
Two in-process reads and one fresh-process read returned the same complete
object, while the recursive byte, entry, mode, link, inode, size, ctime, and
mtime identity snapshot beneath `.agents` remained equal.

The fully derivable fixture displays five derivable decisions and five proof
facts, including multiple source-anchored proof paths. The contradiction
fixture displays five decisions, two blockers, two contradictions, and neither
raw contradiction values nor source paths. Absence is always `not derivable`,
never false or NO-GO. The complete 128-blocker maximum projects within the
accepted byte bound; an incomplete 129-item query fails closed.

## Validation

- TypeScript build: pass.
- Focused Current State tests: 5/5 pass.
- Combined maintained-state reader/query/store/writer/workflow/projection tests:
  37/37 pass.
- Stage 0 oracle: 19/19 pass; native engine parity: 19/19 pass.
- Full MCP: 632/632 pass, zero skipped.
- Root: 81/81 context regressions and 400/400 Node tests pass.
- Ownership: 17/17 pass.
- Packed filesystem containment: pass with 461 entries (440 mode `0644`,
  21 mode `0755`) and inventory SHA-256
  `764e5eeb0e57e6df6e0ad70cc513c6b20e8d4b1b99b342af989921d408bb790e`.
- Package tarball SHA-256:
  `54dada9d91281b2825ad33bbcf42a31e0e792d44101f3f59411385cc24511729`.
- `git diff --check`: pass.
- Cortex update/graph load: pass with 192 files, 6 rules, 1,647 chunks,
  666 constraint relations, and 623 call relations. The host killed semantic
  embedding generation, so the accepted local fallback is lexical-only;
  file-anchored pattern evidence for this report passes against Packet 075 and
  the accepted predecessor reports. Cortex Doctor passes 7/8 checks with only
  the missing embedding manifest warning.
- Combined Core/Contract/Security/Validation review: GO with zero findings and
  zero conflicts. The local deterministic review covered all seven changed
  files (`diff_hash`
  `44057f85b40b692b0d44e74d348a88f4ab96c1a4380e6f743cf57c3cca0b21f8`);
  manual contract/security review covered the four code files for which the
  repository has no applicable convention profile.

Ownership advances from immutable v5 to v6 and adds exactly three managed
paths: the TypeScript source, built JavaScript, and focused test for the
Current State projection. The package inventory adds those three paths plus
immutable `scaffold/ownership/v6.json`; managed ownership is 420 paths and
runtime ownership remains 96.

## Stopped Boundaries

Trusted initial authority provisioning remains absent. Production manager-log,
handoff-ledger, packet, or other document mutation remains absent. No public
CLI/MCP render or writer, workflow auto-emission, dogfood state mutation, or
WO-055 phase is authorized or implemented.
