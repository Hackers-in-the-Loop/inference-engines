# Benchmarks

Benchmarks run through the launcher against a recipe's endpoint, so every result records the recipe, catalog commit, pinned source, params, devices and acknowledged terms it was produced under.

```sh
npm run launcher -- suites
npm run launcher -- bench <recipe-id> --suite <suite> --tier smoke
```

Results are written to `hardware/<hardware>/<model>/<recipe>/benchmarks/results/<date>-<suite>-<tier>/`:

- `run-config.json`: recipe and suite pins, source and catalog commits, params, placements and acknowledgments.
- `raw.jsonl`: one line per request, with timings, usage, tool calls, errors and engine-metric deltas.
- `summary.json`: aggregates. Failed requests count against the result; they are never dropped or retried silently.

## Suites

Suites live in `suites/<name>/suite.yaml`. Each pins its harness version and datasets. Status is one of:

- `ready`: implemented and run.
- `defined`: specified with pinned harnesses, but not yet run against any recipe.
- `placeholder`: design pending.

| Suite | Status | Applies to | What it measures |
| --- | --- | --- | --- |
| `perf` | ready | all | TTFT, latency, client decode tok/s, and engine-reported prefill and decode rates on the recipe's workload. One warm-up request first. |
| `fidelity` | ready | all | The engine against a reference implementation of the same weights. The recipe supplies the command (`benchmarks.fidelity`). |
| `tool-calls` | ready | tool-calling, routing | Exact ordered tool calls on the recipe's frozen workload. This is a project workload, not a public score. |
| `tool-calling-card` | defined | tool-calling, routing | BFCL v4, τ²-bench, and the benchmarks on the Needle 3 model card (BFCL v4, Mobile Actions, DroidCall, DSTC8, SNIPS). |
| `general` | defined | general | MMLU-Pro, GPQA Diamond, IFEval, AIME 2025 (lm-evaluation-harness). |
| `coding` | defined | coding | EvalPlus smoke; LiveCodeBench, Aider Polyglot and SWE-bench Verified as card-tier items. |
| `taste` | placeholder | all | Artistic and stylistic judgement. Never merged into quality scores. |

Each suite has a `smoke` tier, a small fixed subset for every change, and a `card` tier, which is the full run and comparable to model-card numbers when settings match. Compare quality against the same model on a reference engine using the same sampling and thinking settings; model-card numbers are context.
