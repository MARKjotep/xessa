# Performance (v0.1)

Benchmark measurements cover 100 and 1,000 source files, recording cold build, incremental build,
completion latency and memory. **These are measurements, not promises.** Numbers
vary by machine, file size and build shape; the synthetic fixtures below are deliberately small and
regular.

## How to reproduce

```sh
bun run benchmark                       # both sizes, human table
bun scripts/benchmark.ts --size 1000    # one size
bun scripts/benchmark.ts --json         # machine-readable report
```

`scripts/benchmark.ts` generates a deterministic project in a temporary directory, verifies that
every build has **zero error diagnostics**, and then measures each metric 5 times, reporting the
median (min/max are printed too). Each size runs in its own child process so peak memory is not
polluted by a larger run.

## What is generated

| Fixture | Shape |
|---|---|
| Entries | `src/file-0000.cssx` … one entry per requested file |
| Tokens | `src/tokens.cssx` with `spacing`/`radius` |
| Import chain | `src/chain/chain-0.cssx` … `chain-9.cssx`; each imports the previous, `chain-0` imports the tokens; every entry imports `chain-9` and `tokens` |
| Rules per file | one class with base declarations, `@md`/`@xl` inline variants, a `@dark` variant, `&:hover`, `&:focus-visible`, `& > .icon` and a rule-scoped `@md` block |
| Size | roughly 1.3 KB of Xessa per entry |

The generator is pure (same bytes every run). The import chain is bounded at 10 token modules so a
single-file compile reads a realistic small dependency set instead of the whole project.

## What is timed

| Metric | Definition |
|---|---|
| **Cold project build** | `compileProject()` over every entry with a fresh module graph read from disk; full pipeline (parse → resolve → lower → substitute → runtime tokens → rename → group → flatten → emit CSS → plan outputs → class map). **No files are written.** |
| **Single-file incremental** | One `compile()` call for the middle entry, including reads of its imported token modules, **excluding any filesystem write**. |
| **`parse()` proxy** | One tolerant `parse()` of that entry from an already-loaded string — the cheapest model of per-keystroke editor analysis. It does not include the extension's symbol/alias analysis. |
| **Memory** | `process.memoryUsage()` after the build plus the OS peak RSS (`process.resourceUsage().maxRSS`). The generation baseline (fixture creation only) is recorded so build growth is visible. |

## Machine context

| Item | Value |
|---|---|
| CPU | Apple M1 Pro (10-core), 16 GB unified memory |
| OS | macOS 27.3 (Darwin `27.3.0`), arm64 |
| Runtime | Bun `1.4.5` (bundles Node compatibility `26.3.0`) |
| Standalone Node (CLI smoke) | `v24.22.3` |
| Date of measurement | 2026-11-24T20:02Z |

The benchmark reports Bun's bundled Node compatibility version, not the separately installed
`node` binary used by `tests/integration/node-smoke.test.ts`.

## Results (median of 5 runs)

| Metric | 100 files | 1,000 files | Target | Status |
|---|---|---|---|---|
| Cold project build (no writes) | **63.6 ms** (59.5–88.1) | **557.4 ms** (539.5–681.2) | none stated | measured |
| Single-file `compile()` (incl. its imports, no write) | **2.24 ms** (2.19–2.49) | **2.12 ms** (2.00–3.27) | < 100 ms excluding filesystem overhead | **met** with large margin |
| `parse()` proxy (in-memory source) | **0.032 ms** (0.024–0.056) | **0.033 ms** (0.025–0.044) | completion < 100 ms for cached files | **met by this proxy** (see caveat) |
| RSS after build | 59.5 MB | 109.0 MB | none stated | measured |
| Heap used after build | 12.8 MB | 22.6 MB | none stated | measured |
| Peak RSS (whole child process) | 61.3 MB | 115.1 MB | none stated | measured |
| Peak RSS growth over fixture baseline | +42.7 MB | +97.1 MB | none stated | measured |
| Generated artifacts (CSS + JS + opt-in d.ts) | 95,086 B | 950,874 B | none stated | measured |
| Error diagnostics | 0 | 0 | 0 | met |

The first run in each process is slower (JIT warm-up; observed 88 ms for 100 files and 681 ms for
1,000 files). The table reports the median, which is the required figure. Artifact bytes are lower
than the CSSX-A52 recording because generated class maps no longer emit a CSS side-effect import.

### Are the §9 targets met?

- **Single-file incremental compile under 100 ms excluding filesystem overhead — measured and met.**
  We measured 2.1–2.2 ms *including* reading the entry's 11-module import chain. The compiler does
  not keep an incremental cache in v0.1, so this number includes re-parsing the entry and its
  token modules; there is no hidden warm state making it look better than it is.
- **Completion under 100 ms for cached ordinary files — measured proxy only.** The measured
  `parse()` of a cached file is ~0.03 ms. Real completion also runs alias-table construction, token
  and class scans, and the VS Code provider plumbing, which this benchmark does not include. The
  extension debounces analysis by 150 ms and discards stale versions; no end-to-end editor latency
  target has been measured yet. Do not quote 0.03 ms as "completion latency".

## Honest caveats

- The synthetic entries are small and uniform. A 1,000-file project of much larger stylesheets will
  parse, lower and emit proportionally more work per file.
- The cold build does not write files. CLI wall time adds atomic writes, hashing and manifest
  maintenance; see `tests/integration/cli-build.test.ts` for functional coverage, not performance.
- These numbers come from one machine (Apple Silicon, Bun). Node runtime numbers may differ; only
  correctness is verified on Node (`tests/integration/node-smoke.test.ts`).
- Memory figures include the compiler's module graph, emitted text and fixture data for that size.
  Peak RSS is process-wide and monotonic.
- No promise is made that a future version will keep these numbers. Treat regressions larger than
  the observed run-to-run spread (roughly ±10–20%) as worth investigating.

## See also

- [compatibility.md](compatibility.md) — what was tested for correctness.
- [known-limitations.md](known-limitations.md) — missing features that affect real projects.
