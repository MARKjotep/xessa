# CSSX-U5 — Performance in the host

**Phase:** U5 of `.ai/plans/CSSX-PLAN-UI.md` · **Status:** 🟢 complete (the plan's phase row is left 🔴; build owns the flip)
**Date:** 2026-11-26 · **Tree:** `main`, uncommitted shared wave tree
**Write set used:** `packages/vscode/test/ui/performance.js`, `packages/vscode/test/ui/perf-documents.js`,
`packages/vscode/test/suite.js` (scenario registration), this report. Not touched:
`packages/vscode/src/**`, `packages/vscode/package.json`, `tests/extension/**`,
`tests/stress/editor/**` (read-only reference).

## Summary

- Latency is measured **through the real host pipeline**: `executeCompletionItemProvider`,
  `executeHoverProvider`, `executeDefinitionProvider`, `executeDocumentColorProvider`,
  `executeDocumentSymbolProvider`, `executeReferenceProvider`, diagnostic publication after an edit, a
  keystroke storm driven through the workbench **`type`** command, and heap across 20 open/close cycles —
  all in the extension host of VS Code **1.147.0** on a 10 008-line / 225 997-char Xessa document
  (0 diagnostics, 562 inline swatches, 1 108 class tokens, exactly **117** `$gap` references — TT6's
  document had the same 117 references).
- **No unexplained regression.** completion p95 **1.70 ms** vs TT6 0.4 ms, hover **5.81** vs 6.0,
  definition **2.62** vs 2.5, references **5.59** vs 5.4: the host plumbing (renderer ↔ extension-host
  round trip + DTO conversion) accounts for the completion delta and the rest are at parity. The only
  larger deltas are explained and reproduced: **document symbols 26.3 ms vs 5.2 ms** (560 outline nodes
  serialised over the API) and **document colours 3.26 ms vs 1.2 ms** (562 swatch DTOs), and the
  **typing storm 663 ms for 196 real keystrokes** where TT6's 49.7 ms for 932 keystrokes had no renderer
  or workbench in the path (the same insertions through `TextEditor.edit` cost **1.35 ms/edit**).
- Diagnostic publication after an edit is **~227 ms p50 / 235 ms p95** — the 150 ms debounce
  (`service.ts`) plus a full re-analysis of the 10 000-line document. The clearing path is symmetric
  (229/234 ms), and the last version always wins (no stale publish: the final assertion is an empty set).
- Heap across 20 open/close cycles of the 10 000-line document: **167 MB → [174…187, GC…163…169] → 169 MB**
  — bounded, no monotonic rise.
- **One real UI defect pinned** (found by this document, reported as **CSSX-U5-A**): `$token` references
  inside `@group.<name>` definitions and use-site bodies resolve in analysis (no diagnostic) but have
  **no hover and no definition** in the host.
- `bun test tests/extension/host.test.ts` → **12 scenarios / 606 assertions** (performance scenario: 35),
  green twice; `bun run verify` and `bun run lint` green.

## Changed paths

| Path | Change |
|---|---|
| `packages/vscode/test/ui/performance.js` | **new** — U5 scenario (35 assertions, ~9 s of the suite) |
| `packages/vscode/test/ui/perf-documents.js` | **new** — local reimplementation of TT6's document generator (plain CommonJS) |
| `packages/vscode/test/suite.js` | `"performance"` appended to `SCENARIOS` |
| `.ai/reports/CSSX-U5.md` | this report |

## Machine context and method

| Item | Value |
|---|---|
| Host | VS Code **1.147.0**, cached at `node_modules/.vscode-test-xessa/vscode-darwin-arm64-1.147.0` |
| Runtime | Electron **43.8.9**, Node **24.22.1**, Chromium **150.0.7871.250**, `darwin`, `arm64` |
| Machine | Apple **M1 Pro**, 8 cores, 16 GB RAM |
| Document | 10 008 lines, 225 997 chars, **0 diagnostics**, 554 rule blocks (1 108 class tokens), 562 hex swatches, 1 `@keyframes`, 555 `@group` use sites, **117** `$gap` references |
| Iterations | 20 per provider/operation (nearest-rank percentiles, one un-timed warm-up call before the samples), 20 break/fix diagnostic pairs, 20 open/close memory cycles |
| Timing | `performance.now()` in the extension host, around the awaited `executeCommand` round trip |
| Ceilings | provider p95 < **2 000 ms**, diagnostic p95 < **5 000 ms**, storm < **60 000 ms**, heap growth < **400 MB** — ~50–100× the measured values so a slow machine records a number instead of failing |

Run command: `bun test tests/extension/host.test.ts` (the orchestrator rebuilds the bundle and launches
the cached host; no orchestrator change was needed). The numbers below are the second of the two
back-to-back runs (`/tmp/xessa-u4-iter7.log`), and the `verify` run reproduced them within noise.

## Recorded latency — real host, 10 000-line document (p50 / p95 / max, ms)

| Case | n | p50 | p95 | max |
|---|---|---|---|---|
| cold analyse + compile (first provider call: outline) | 1 | — | — | **47.95** (open of the document itself: 224 ms) |
| `executeCompletionItemProvider` (`$` at a `$gap` reference) | 20 | 1.165 | 1.701 | 1.831 |
| `executeHoverProvider` (`$gap`) | 20 | 5.338 | 5.811 | 6.296 |
| `executeDefinitionProvider` (`$gap`) | 20 | 2.403 | 2.620 | 2.630 |
| `executeDocumentColorProvider` (562 swatches) | 20 | 2.938 | 3.257 | 5.484 |
| `executeDocumentSymbolProvider` (560 outline nodes) | 20 | 25.735 | 26.321 | 26.695 |
| `executeReferenceProvider` (`$gap`, 117 hits) | 20 | 5.116 | 5.589 | 7.156 |
| `executeDefinitionProvider` (`@group.` use site) | 20 | 2.341 | 2.612 | 2.668 |
| diagnostics **appear** after an edit (missing `;` → `XESSA1002`) | 20 | 227.262 | 235.245 | 244.986 |
| diagnostics **clear** after the fix | 20 | 229.562 | 234.406 | 234.649 |

Work assertions inside the same scenario (so a fast number cannot come from doing nothing): completion
items > 0, hover Markdown contains `compile-time token`, definition ≥ 1 target, > 100 swatches,
references > 50, exactly one `XESSA1002` at the broken declaration's line, document byte-identical after
the loop, empty diagnostics after the last fix, heap series of length 20, `unhandledRejection` array empty.

## Typing pipeline

| Case | Drive | Result |
|---|---|---|
| Keystroke storm | workbench **`type`** command, one character per call (`vscode.commands.executeCommand("type", { text })`) — the real renderer → extension-host typing path on a 200-line generated document | **196/196 keystrokes in 663 ms** (**3.38 ms/keystroke**), 197 `onDidChangeTextDocument` events, no throw, no rejection |
| Same insertions, API level | `TextEditor.edit` per character | 196 edits in **265 ms** (**1.35 ms/edit**) — the comparable figure for TT6's 932-keystroke replay |

TT6's replay ran `parse` + the four provider entry points in-process: 932 keystrokes in **49.7 ms**
(0.05 ms/keystroke). The host figure is ~68× per keystroke; the difference is the workbench `type`
round trip plus the debounced document-change fan-out (and the 200-line document's analysis per
debounce). The `TextEditor.edit` number isolates the extension-host side: 1.35 ms/edit, i.e. the same
order of magnitude as TT6 once IPC is excluded. Nothing is explained away as "it is just slower".

## Diagnostics publication (debounce + full re-analysis)

- Debounce is 150 ms (`service.ts`, `DEFAULT_DELAY_MS`); the measured 227/235 ms means a full
  re-analysis of the 10 000-line document costs roughly **80 ms** on this machine inside the
  cross-process path (the pure `analyzeDocument` in TT6 is 168 ms p95 with the compile; the host path
  warm-caches the compile and re-analyses the change).
- Clearing is symmetric (229/234 ms) — no asymmetry to investigate.
- Version guard: after the last fix the published set is empty and stays empty, and the document text is
  byte-identical to the generated original; no stale publication was observed in 20 pairs.

## Memory across 20 open/close cycles (10 000-line document, `process.memoryUsage().heapUsed` in the extension host)

```
before  167 MB
series  174, 180, 186, 163, 169, 175, 181, 187, 163, 169,
        175, 181, 186, 163, 169, 175, 180, 186, 163, 169
after   169 MB
```

The sawtooth is GC; the envelope is flat (163–187 MB) and the end state is +2 MB. No monotonic rise, so
the plan's "monotonic rise across cycles is a finding" condition is not met. The measurement asserts the
service cache is dropped on close (diagnostics for the closed URI are empty afterwards) and that heap
growth over all 20 cycles stays under a generous 400 MB ceiling.

## Comparison against the TT6 pure layer

TT6 (`.ai/reports/CSSX-TT6.md`, same machine, Bun 1.4.5, p95 ms, nearest-rank) vs this run (p95 ms,
through the host):

| Operation | TT6 pure | Host | Ratio | Verdict |
|---|---|---|---|---|
| completion | 0.4 | 1.70 | 4× | **explained** — the provider runs in ~0.4 ms; the rest is the renderer ↔ host round trip and DTO conversion (the harness command is the same dispatch the suggest widget uses) |
| hover | 6.0 | 5.81 | 0.97× | **parity** — hover work dominates the round trip |
| definition | 2.5 | 2.62 | 1.05× | **parity** |
| references (117 hits) | 5.4 | 5.59 | 1.03× | **parity**; both resolve exactly 117 locations |
| colours (562 swatches) | 1.2 | 3.26 | 2.7× | **explained** — 562 `ColorInformation` DTOs cross the API boundary; the provider itself is the 1.2 ms |
| document symbols (560 nodes) | 5.2 | 26.3 | 5× | **explained** — the `DocumentSymbol` tree (560 nodes, nested) is the largest DTO the API returns; ~21 ms is serialisation |
| diagnostics publication | 168 (`analyzeDocument` p95) | 235 (from edit) | 1.4× | **explained** — debounce 150 ms is already inside the host figure, so the analysis part is ≈85 ms on a warm cache |
| keystroke storm | 49.7 ms / 932 keys | 663 ms / 196 keys (workbench `type`) · 265 ms / 196 (`TextEditor.edit`) | — | **explained** — TT6 had no renderer/workbench in the path; the `edit` figure is the like-for-like comparison |
| cold analyse + compile | 21.7 (`analyzeText`) / 173.3 (`analyzeDocument`) | 47.95 (first provider) | 0.28× / 1.1× | **explained** — the first provider call is a warm `analyzeNow` after the document opened (the debounced analysis already ran during `showTextDocument`), so it is not the full cold path |

No host figure is an unexplained order-of-magnitude regression. The two largest per-call deltas (symbols,
colours) grow with the number of returned items, which is the DTO cost, and both would be visible to a
user as "outline appears a few ms slower", not as an interaction stall. The plan's requirement — record
the table with machine context and give every cell a verdict — is met; nothing is marked a regression.

## Defect pinned — CSSX-U5-A: tokens inside `@group.` bodies have no hover and no definition

- **What:** a `$token` reference inside a `@group.<name>` **definition** body, and inside a
  `@group.<name>` **use-site** body, returns **0 hovers and 0 definitions** in the host, while the same
  token in a plain rule or a `&:hover`-nested rule returns the normal card/target. Analysis resolves the
  token (the document has **no** diagnostic), so this is provider coverage, not analysis.
- **Minimal repro (measured, two windows):**
  ```
  @variables { gap: 8px; radius: 3px; }
  @group.card {
    padding: $gap;              // line 2 → hover = 0, definition = 0
  }
  .a {
    padding: $gap;              // line 5 → hover = 1 ("**$gap** — compile-time token / Value: `8px`"), definition = 1
    &:hover { margin: $gap; }   // line 6 → hover = 1, definition = 1
    @group.card { border-radius: $radius; }  // line 7 → hover = 0, definition = 0
  }
  ```
  Diagnostics: `[]` for the whole document. Completion at those positions still answers (1 item with the
  `$` trigger), so the service is warm.
- **Where pinned:** recorded here (the U5 module deliberately probes `.rule-500` instead, so the timing
  rows measure real work); no host assertion currently pins the empty result because the fix belongs to a
  task. Candidate task: **CSSX-U5-A**, acceptance = an assertion in `hovers.js`/`navigation.js` flips from
  0 to 1 for a token inside a `@group.` definition and use site.
- **Scope note:** the same shape appears in TT6's generated document (`@group.stress-card { padding: $gap; }`),
  so this is not an artefact of the U5 generator.

## Deviations from the plan's §U5 text

1. **The 10 000-line document is a local reimplementation**, not an import of
   `tests/stress/editor/documents.ts`: the host suite is plain CommonJS and cannot load TypeScript, and
   the plan forbids editing `tests/stress/**`. `perf-documents.js` reproduces the same shape (setup,
   media types, variables, runtime tokens, keyframes, a group definition, rules with inline media
   variants, `&:hover`, nested `& > .child`, group use sites and `$keyframes.`), and emits a clean
   document. Absolute bytes differ from TT6's, so the report compares per-operation costs and the
   provider/item counts it records (117 references, 562 colours) rather than the raw document.
2. Plan file name `ui/perf.js`; the brief names `performance.js` — used the brief's name.
3. The plan proposes a `XESSA_UI_PERF=1` gate; the scenario instead runs on every host suite run with
   generous ceilings (the numbers are the deliverable and they are cheap: ~9 s of a ~31 s suite). No gate
   is needed to keep `bun test` fast, and a regression cannot hide behind a skipped scenario.
4. Memory uses `process.memoryUsage().heapUsed` in the extension host (the RV8/RSS of the *renderer* is
   not reachable from an extension). Recorded as an API limit rather than replaced with a proxy.
5. The keystroke storm uses the workbench `type` command (measured drivable — 196/196 characters landed,
   197 change events) *and* reports `TextEditor.edit` as the API-level comparison; the plan's "whichever
   is drivable" is satisfied by using both and recording which one is which.

## Honest limitations

- `performance.now()` is wall clock in a shared development host (the previous scenarios' documents stay
  open in the window). The warm-up call and one-document-per-file isolation keep this small; the run-to-run
  spread (e.g. completion p95 1.60–1.81 ms across runs) is recorded rather than hidden.
- The host runs with `--disable-extensions`, but VS Code's built-in agent-host extensions still load
  (U1 note) — they do not register Xessa providers, so they affect IPC timing at most.
- The renderer's RSS and the suggest widget's own render cost are U3/CDP territory; U5 measures the
  language-service side of the pipeline.

## Verification

| Command | Result |
|---|---|
| `bun test tests/extension/host.test.ts` (×2, back-to-back) | green — `12 scenarios, 606 assertions` each, performance scenario 35 assertions, `2 pass / 0 fail` |
| `bun run verify` | green — `1160 pass / 2 skip / 0 fail`, 85 files, host suite included |
| `bun run lint` | green — 502 files |
