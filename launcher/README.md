# Launcher

The launcher finds a recipe by name, resolves which of your machines and devices will run it, shows you exactly what it's going to do, and then runs the recipe's steps: setup, fetch, build, deploy, serve and health. It also runs benchmarks against a running recipe. It orchestrates processes and SSH; it contains no inference code.

Requires Node ≥ 23.6, which runs the TypeScript sources directly without a build step, plus `git` and `flock`. Remote nodes need `git`, `bash`, `flock` and SSH key access.

```sh
npm install
npm run launcher -- list
npm run launcher -- check <id>            # run plan and checks; changes nothing
npm run launcher -- up <id> [--detach]    # run the recipe
npm run launcher -- status
npm run launcher -- down <id>
npm test
```

## Commands

| Command | What it does |
| --- | --- |
| `list [--hardware H] [--purpose P] [--all]` | Recipes with status, isolation, license, and components that need acknowledgment. |
| `show <id>` | Manifest summary, attribution and terms. |
| `check <id>` | Resolves nodes, prints the run plan, runs toolchain checks, and tests whether device locks are free. Changes nothing. |
| `up <id>` | Shows the run plan, collects acknowledgments, then runs the steps. It stays attached until Ctrl-C unless `--detach`. |
| `down <id>` | Runs the recipe's stop step (if any), stops `serve` on every node, and releases device locks. |
| `status` | Running recipes and whether they answer. |
| `validate [<id>]` | Schema, unique names, acknowledgment and verified-pin rules. |
| `upstream <id>` | Adapter recipes: has upstream's default branch changed the files in `adapter/upstream.lock` since the pin? |
| `suites`, `bench <id> --suite S [--tier smoke\|card] [--out DIR]` | Benchmark suites, and running one. If the recipe is not already up, `bench` starts it and stops it afterwards. |
| `inventory [--probe]` | Shows your inventory, or probes this host. The probe never opens a serial port. |

Run options:

| Option | Meaning |
| --- | --- |
| `--profile P`, `--param k=v` | Choose a named preset, or set individual params. |
| `--port N` | Endpoint port. |
| `--on <host\|label>` | Limit placement to specific hosts or devices. |
| `--inventory FILE` | Use a different inventory file. |
| `--only step,step` | Run only these steps. |
| `--timeout S` | How long to wait for health. |
| `--otel` | Start an OpenTelemetry Collector sidecar (Podman or Docker) that scrapes the engine's `/metrics`. It writes OTLP JSON into the run record and forwards to `OTEL_EXPORTER_OTLP_ENDPOINT` when that is set. |
| `--yes` | Answers "Continue?". It never covers license terms. |
| `--accept <component>` | Acknowledges a restricted component non-interactively. |
| `--source <path\|url> --commit <sha>` | Runs a different checkout for development. The run is marked as overridden and is not evidence for the pinned recipe. |

## What a run leaves behind

- `~/.local/state/inference-engines/runs/<recipe>/<timestamp>/`
  - `run.json`: catalog commit, source commit, params, placements, the run plan shown, acknowledgments, and step results.
  - `logs/`: one log per step and node.
  - `telemetry/`: collector output, with `--otel`.
- `~/.local/state/inference-engines/active/`: state for running recipes.
- `~/.local/state/inference-engines/acknowledgments.json`: license acknowledgments, keyed by recipe, component and terms hash.
- `~/.cache/inference-engines/<recipe>/`: the pinned checkout (`src/`), the adapter copy, and the recipe's downloads and builds.

The inventory lives at `~/.config/inference-engines/inventory.yaml`; start from [`inventory.example.yaml`](inventory.example.yaml). The recipe format and step environment are documented in [`docs/recipe-format.md`](../docs/recipe-format.md).

## Tested and untested paths

`npm test` covers these paths end to end on the local executor, using a fake OpenAI engine and a local git upstream:
- manifest validation, placement for one board, two GPUs on one host, and two hosts;
- the step environment and `env_map`;
- the checkout, `upstream.lock` refusal and drift reports;
- the run plan, and acknowledgment handling;
- device locks, detached `up`, `status`, `down`, and failed health;
- the perf and tool-call benchmarks.

The SSH executor is covered by unit tests of its command construction only. It has not yet run against real remote hosts.
