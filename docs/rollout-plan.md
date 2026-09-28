# Rollout plan: recipes, attribution, launcher, benchmarks

Status: rolled out on 2026-09-28, apart from the hardware-gated and optional items listed under [Implementation status](#implementation-status-2026-09-28). The reference for the format as built is [recipe-format.md](recipe-format.md).

This plan covers what must exist before the first engines launch from this repository:

1. A recipe manifest that records provenance and attribution.
2. A launcher that resolves a recipe name to a manifest and runs it on one device, several devices on one host, or several hosts.
3. An `/add-recipe-from-link` skill that turns someone else's published recipe into a manifest.
4. A benchmark plan based on each model's purpose, using industry-standard suites plus a placeholder for "taste".

The design is based on three kinds of existing work:

| Engine | What it is | What it teaches |
| --- | --- | --- |
| [Needle 3 on ESP32](https://github.com/iammrduncan/esp32-needle-3) (ours, Apache-2.0) | C engine and ESP-IDF firmware; Python host bridge over USB serial; model sliced to 2–8 layers | "Launch" means build, then flash two images (the app, and the model at `0x210000`), then run a host bridge. It needs two serial ports. The layer count is a real parameter. Provenance is already careful (`NOTICE`, `model/manifest.json` with SHA-256, `benchmarks/config.json`). |
| Qwen 3.8 27B on P100 (ours, unpublished, still improving) | llama.cpp-derived engine with custom sm_60 kernels, run in a Podman CUDA 12.6 container on the R580 driver | Upstream pins already exist in `pins.json`: engine commit, model revision, CMake flags. `start.sh` is driven by environment variables, and quality gating (teacher-forced KL against an anchor) is strict. The engine is a patch series on third-party code with several upstream authors. |
| [DGX Spark external recipes](../hardware/gb10-dgx-spark/external/spark-awesomelist.md) (for example Mia AI Lab's) | Docker and vLLM (or EXL3), TP=1/2/3/4 across Sparks over NCCL/RoCE, driven by `.env` and `start.sh`/`stop.sh` | The multi-node inputs are site-specific: `HEAD_IP`, `WORKER_IP`, `IFACE`, `IB_HCA`, `IB_GID_INDEX`. Code licenses are AGPL-3.0 (one repo is dual MIT). Model licenses vary, including the NVIDIA Open Model License, the Qwen Community License, and CC BY-NC-ND for one drafter. Some checkpoints are gated. |

## Decisions (2026-09-27)

- Manifests are YAML, validated by a JSON Schema.
- Engines live in their own repositories, including in the author's personal GitHub, and are linked from here at pinned commits. This repository is the catalog, launcher and benchmark layer that brings them together.
- The launcher does not manage containers; recipe steps do. The launcher must state before running exactly how a recipe executes: in a container, on the host without isolation, with sudo, flashing a device, and so on.
- Gated and non-commercial components are allowed in `verified` recipes. They must be declared explicitly in the manifest, and the user must acknowledge them before the launcher downloads or runs anything.
- Running on the host without a container gets a clear warning in the run plan, but no extra acknowledgment.
- Needle 3 ships the 6.15 tok/s matrix firmware, not the unpromoted 6.22 tok/s tree.
- Our own engine repositories are restructured into the native engine format before they are listed, starting with Needle 3 on ESP32. That work happens in those repositories (section 6). P100 is deferred.
- Repositories we don't control are used as published. A conversion adapter kept in this repository drives them (section 6). We never ask owners to reformat their work.

## Principles

- **No surprises at run time.** Before any step runs, the launcher prints what will happen and where: each step's host, isolation level, privileges, devices it writes to, downloads, network exposure and license terms. It waits for confirmation (section 3).
- **Link, don't copy.** An external recipe is referenced by URL and pinned commit, and fetched at launch. This repository holds the manifest, results, and an adapter when the upstream repo doesn't follow our format. We vendor only when a license clearly permits it and there is a reason. This avoids relicensing questions (AGPL in particular) and keeps credit with the author's repository.
- **The recipe owns the how; the launcher owns the where.** Steps are plain executables in any language. The launcher chooses devices and hosts, sets a documented environment, runs the steps in order, and records what happened.
- **Nothing site-specific is committed.** IP addresses, interfaces, serial ports, tokens and paths live in a local inventory file outside the repo.
- **Claims carry a status.** A recipe has the status `unverified` until someone runs it here on the listed hardware and commits the evidence.

## 1. Recipe layout and identity

```
hardware/<hardware>/<model>/<recipe>/
  recipe.yaml        # manifest (below)
  NOTICE             # only if the recipe carries patches or third-party code; otherwise attribution lives in recipe.yaml
  adapter/           # conversion layer for repos that aren't in native format; any language
  benchmarks/        # recipe-specific workloads and committed results
```

Each recipe has a globally unique `id`, for example `needle3/esp32-s3/8-layer` or `qwen3.8-flash-next/gb10-dgx-spark/mia-tp2`. The launcher builds its name → manifest map by scanning `hardware/**/recipe.yaml`, so there is no hand-maintained registry to drift. The launcher's `validate` command rejects duplicate ids or aliases.

**Format:** YAML, validated by a committed JSON Schema (`schema/recipe.schema.json`). YAML allows comments, and the schema makes the file checkable by the launcher and by agents.

## 2. Manifest: provenance, attribution, topology, steps

An illustrative manifest for the first recipe, as it would look after the Needle repository cleanup in section 6. Pins, hashes and licenses come from the Needle repository and model card. `TODO` marks what does not exist yet, and the `make` targets that take `IE_*` variables are part of that cleanup.

```yaml
schema: 1
id: needle3/esp32-s3/8-layer
aliases: [needle3-esp32]
title: Needle 3 tool router on ESP32-S3
status: unverified            # unverified | verified | experimental | deprecated
purpose: [tool-calling, routing]   # selects benchmark suites (section 5)

attribution:
  authors:                    # everyone credited, with their role
    - {name: iammrduncan, url: https://github.com/iammrduncan, role: author}
    - {name: Andris Gauracs, url: https://github.com/andrisgauracs/needle-2-esp32, role: upstream-engine}
    - {name: "Cactus Compute, Inc.", url: https://github.com/cactus-compute/needle, role: model}
  cite:                       # upstream citation, reproduced as given
    - {title: "Needle: Automation Foundation Model for Tiny Devices", year: 2026,
       organization: "Cactus Compute, Inc.", url: https://github.com/cactus-compute/needle}
  source:
    repo: https://github.com/iammrduncan/esp32-needle-3
    commit: TODO-pin-release-commit
    license: Apache-2.0       # SPDX id
    relationship: linked      # linked | forked | vendored | reference
    integration: native       # native | adapter (section 6)
  components:                 # third-party pieces this recipe pulls in
    - kind: engine
      name: needle-2-esp32
      repo: https://github.com/andrisgauracs/needle-2-esp32
      commit: 61cafad7014a5664bb3ffd5f0c457ce5aa6598ae
      license: Apache-2.0
    - kind: weights
      name: Cactus-Compute/needle3
      revision: 9da75122d4ca11aa4a667281c9c8ba38a7eed679
      sha256: c9d915eca282ed42d1a09b143b592adb4cc6744ffe2d294adf5cfc5548170c38
      license: Apache-2.0      # Hugging Face model card: "license: apache-2.0", checked 2026-09-27
      terms: {gated: false, commercial: true}
  notes: Weights are downloaded by the user and never committed.

runtime:                      # disclosed to the user before anything runs
  isolation: host             # container | vm | host  (host prints a warning)
  privileges: [serial-device-access]   # e.g. sudo, docker-group, serial-device-access
  device_writes: [flash-erase-and-write]  # overwrites ESP32 bootloader, app and model partitions
  network: {listen: 127.0.0.1}           # no auth on the bridge; loopback only
  downloads: [{what: needle3.cact, approx_bytes: 35335380}]

hardware:
  targets:
    - kind: mcu
      match: {chip: esp32-s3, psram_mb: ">=16", flash_mb: ">=32"}
      ports: [flash, serial]  # two USB serial roles
  topology: {nodes: 1, devices_per_node: 1}

params:                       # exported to steps as IE_PARAM_<NAME>
  layers: {default: 8, allowed: [2, 3, 4, 5, 6, 7, 8]}   # 1 is diagnostic only; 9 does not map into MMU
profiles:                     # named presets
  fast: {layers: 4}

toolchain:
  - {name: esp-idf, version: "5.5"}
  - {name: python, version: ">=3.10"}

steps:                        # run in the pinned source checkout ($IE_SRC_DIR); any executable
  setup:  make setup          # venv; ESP-IDF itself is a checked prerequisite
  fetch:  make model          # download pinned archive, slice to $IE_PARAM_LAYERS
  build:  make build
  deploy: make flash          # flashing is a first-class step; uses $IE_PORT_FLASH
  serve:  make serve          # foreground bridge on $IE_PORT_SERIAL and $IE_HTTP_PORT
  health: make health
  stop:   builtin:signal

endpoint:
  protocol: openai            # /v1/models, /v1/chat/completions (added in cleanup)
  extra_routes: [/complete, /route, /agent, /state]
  limits: Tool schemas are fixed at firmware build time.
telemetry:
  metrics: {format: prometheus, path: /metrics}   # firmware EVT timings, exported by the bridge
```

### Field notes

- **`attribution.authors[].role`** uses `author`, `maintainer`, `upstream-engine`, `model`, `patches`, `kernels`, `drafter`, `derived-from`. A recipe built on a patched fork may need several entries, for example the base engine, a patch series, the weight format's author and the quant author.
- **`status`**:
  - `unverified`: not yet run here.
  - `experimental`: runs here, but evidence is incomplete or results are unstable.
  - `verified`: run here on the listed hardware, with full pins and committed evidence.
  - `deprecated`: kept for history; `list` hides it by default.
- **`source.relationship`**:
  - `linked`: fetched at a pinned commit and never edited in place.
  - `forked`: we maintain a fork with changes, and the fork carries upstream `NOTICE` and `LICENSE`.
  - `vendored`: copied into this repo.
  - `reference`: listed only; the launcher will not run it.
- **`source.integration`**: `native` means the steps call the repository's own entry points (the engine format in section 6). `adapter` means the steps call scripts in this recipe's `adapter/` folder, which drive the upstream repository as published.
- **`components[].terms`** records the facts a user must see before download: `gated`, `commercial`, `share_alike`, `acceptance_url`, and a one-line `summary` in plain words. Gated and non-commercial components are allowed in verified recipes, but they carry `acknowledge: required`. Schema validation fails if a gated, non-commercial or share-alike component omits that. `list` and `show` flag these components, and `up` blocks until the user acknowledges them (section 3). The launcher never accepts an upstream license on the user's behalf: for gated weights, the user accepts on the host's site and supplies their own token.
- **`runtime`** is the disclosure block. It is required, because users should never have to read a `start.sh` to find out that a recipe runs as root on the host or flashes their board.
  - `isolation`: whether the steps run in a container (with engine, image and pinned digest), a VM, or directly on the host.
  - `privileges`: sudo, Docker group membership, device access.
  - `device_writes`: flashing or erasing a board.
  - `network`: the listen address and whether auth is enabled.
  - `downloads`: approximate size of what gets fetched.
  - `host_changes`: packages, drivers or services installed, if any.

  Per-step overrides are allowed, for example a host-side `setup` step followed by a containerized `serve`.
- **Pins are mandatory for `verified`.** That means the source commit, weight revision, and a hash for single-file artifacts, plus an image digest when a container is used.
- **`hardware.targets[].kind`** is one of `gpu`, `mcu`, `cpu`, `apple-silicon`, or `npu`. `match` is a small predicate the launcher evaluates against the inventory, such as `{model: GB10}`, `{model: "Tesla P100", vram_gb: ">=16", driver: "580.*"}`, or `{chip: esp32-s3}`.

## 3. Launcher

The entry point keeps the npm form planned in `launcher/README.md`, but takes recipe ids instead of `<hardware> <model>`. It is a Node/TypeScript CLI invoked as `npm run launcher -- <command>`. It orchestrates subprocesses and SSH; it contains no inference code.

```
list [--hardware gb10] [--purpose coding]      # the name map, with status and license flags
show <id>                                      # manifest, attribution, terms
check <id> [--inventory …]                     # resolve devices/hosts, toolchain, terms; change nothing
up <id> [--profile fast] [--param layers=4]    # setup → fetch → build → deploy → serve → health
down <id> | status
bench <id> --suite <name>                      # section 5
validate [<id>]                                # schema, unique ids, acknowledgment rules
upstream <id>                                  # adapter recipes: has upstream changed since the pin?
```

### Disclosure and acknowledgment

`check` and `up` print a run plan before anything executes. For the Needle recipe it would look roughly like this:

```
needle3/esp32-s3/8-layer  (status: verified)
  WARNING  runs on the host, not in a container
  setup    local   creates .venv, pip install -r requirements.txt
  fetch    local   downloads Cactus-Compute/needle3 @9da7512 (~35 MB, Apache-2.0)
  deploy   local   ERASES AND FLASHES the ESP32-S3 on /dev/ttyACM0
  serve    local   HTTP bridge on 127.0.0.1:<IE_HTTP_PORT>, no auth
Continue? [y/N]
```

- A component with `acknowledge: required` adds a block naming the component, its license, its restriction in plain words, and its link. The user must type the component name (or pass `--accept <component>`) to continue; plain `y` is not enough. An example is "CC BY-NC-ND 4.0: research and evaluation only, no commercial use".
- Acknowledgments are stored locally, keyed by recipe id, component and a hash of its terms. If the terms or the pinned revision change, the launcher asks again.
- Non-interactive runs, such as benchmark sweeps, must pass every `--accept` flag explicitly. `--yes` never covers license terms.
- Each run records its disclosure and acknowledgments in the run record, so benchmark results state the terms they were produced under.

### Step contract (language agnostic)

- Before any step, the launcher clones `source.repo` at `source.commit` into `$IE_WORK_DIR/src/`. On multi-node recipes it does this on every node at the same commit, and copies the recipe's `adapter/` folder alongside. The `fetch` step then downloads weights and other artifacts.
- A step is a shell string or a path to an executable. It runs with its working directory set to that checkout. `builtin:*` steps are provided by the launcher, for example signal-based stop or waiting on a port.
- Environment the launcher provides:

| Variable | Meaning |
| --- | --- |
| `IE_RECIPE_ID` | Recipe id being run |
| `IE_RECIPE_DIR` | Recipe directory in this repo |
| `IE_SRC_DIR` | Pinned checkout of `source.repo` |
| `IE_ADAPTER_DIR` | The recipe's `adapter/` folder, for adapter recipes |
| `IE_WORK_DIR` | Per-recipe cache for weights and builds, outside the repo |
| `IE_PARAM_*` | Resolved `params` values |
| `IE_HTTP_PORT` | Port the endpoint should listen on |
| `IE_OTEL_EXPORTER_OTLP_ENDPOINT` | Where telemetry goes |
| `IE_NODE_RANK`, `IE_NODE_COUNT` | This node's position in the topology |
| `IE_NODE_<n>_ADDR` | Address of node `n` |
| `IE_DEVICES` | Local device indices; also mapped to `CUDA_VISIBLE_DEVICES` or `HIP_VISIBLE_DEVICES` |
| `IE_PORT_<ROLE>` | Serial port for each role (MCU recipes) |
| `IE_INV_*` | This node's inventory attributes, for example `IE_INV_IFACE` and `IE_INV_IB_HCA` |

- Exit code 0 means success. `serve` runs in the foreground; the launcher supervises it, captures logs, and records the PID. Readiness is the `health` step or a declared port or path.
- **`env_map`** lets a recipe keep its own variable names instead of being rewritten. For example, a Spark recipe declares `env_map: {HEAD_IP: "${IE_NODE_0_ADDR}", WORKER_IP: "${IE_NODE_1_ADDR}", IFACE: "${IE_INV_IFACE}"}`. The launcher exports those variables to every step, and an adapter writes them into whatever file the upstream expects, such as the `.env` read by `start.sh`.

### Topology resolution

- The local inventory (`~/.config/inference-engines/inventory.yaml`, never committed) lists hosts: SSH target, devices with discovered properties, fabric interfaces and HCAs, and serial ports with board labels.
- `check` fills it from probes such as `nvidia-smi`, `rocm-smi`, `system_profiler`, and `esptool chip_id` on each port.
- The recipe declares `topology: {nodes: N, devices_per_node: M}` and optional `roles: {head: [serve], worker: [serve]}` with per-role steps. The launcher picks matching nodes, assigns ranks with head as rank 0, then runs workers before the head, as the Mia recipes require.
  - **Two GPUs in one box:** `nodes: 1, devices_per_node: 2`, which sets `IE_DEVICES=0,1`.
  - **Two Sparks:** `nodes: 2`. Steps run over SSH on each node, and weight distribution stays whatever the upstream recipe does (rsync or NFS).
  - **Several ESP32 boards:** each board is a node with serial ports. A board lock prevents two runs sharing a port, as the Needle benchmark runner already does.
- Executors start as `local` and `ssh`. There is no Ray or Kubernetes layer; engines that need Ray start it in their own steps.
- Recipes with `topology.variants` (TP=2, 3 or 4) expose them as profiles.

### Endpoint and telemetry

- **Endpoint:** the target is OpenAI-compatible `/v1/chat/completions` and `/v1/models`.
  - vLLM and llama-server already provide it.
  - The Needle bridge does not yet. The endpoint belongs to the engine, so the fix happens in the engine repository (section 6), not in a launcher-side shim. Until then, the manifest states the real protocol.
- **Telemetry:** an OpenTelemetry Collector sidecar started by the launcher.
  - It scrapes Prometheus `/metrics` where the engine has it (vLLM, llama-server `--metrics`).
  - Client-side spans come from the benchmark runner: TTFT, tokens and latency per request.
  - For engines without `/metrics`, a recipe can declare a log parser that turns engine output lines into metrics.
  - Recipes declare which sources apply; the docs list only signals that are actually exported.

## 4. `/add-recipe-from-link` skill

This will be a single skill file, `.claude/skills/add-recipe-from-link/SKILL.md`, referenced from `AGENTS.md` so Codex and other agents follow the same procedure. Given a URL, the agent:

1. Resolves the URL to a repository and pins the current commit.
2. Checks for an existing recipe for the same hardware and model, applying the Spark list's rule: list a recipe if nothing similar exists, or if it performs better.
3. Reads `LICENSE`, `NOTICE`, the README, model cards, and the launch scripts.
4. Records every author and component with SPDX license and terms, and sets `acknowledge: required` on anything gated, non-commercial or share-alike. It fills the `runtime` disclosure from what the scripts actually do: container or host, sudo, installs, flashing, listen address. An unknown value is written as `TODO`, never guessed.
5. Classifies the recipe: hardware, topology, purpose, steps, and the variables to put in `env_map`.
6. Writes `recipe.yaml` with `relationship: linked`, `integration: adapter` (or `native` if the repo already follows the native format) and `status: unverified`. It also writes the `adapter/` scripts and the `upstream.lock` fingerprint (section 6), without editing the upstream repository. It adds the recipe to the hardware README or awesome list, and runs the launcher's `validate`.
7. Opens a PR that summarizes the attribution and any restrictive terms. It suggests a courtesy note to the author but never contacts them automatically. Removal requests from authors are honored.

The skill should be written after the schema and launcher `validate` exist (rollout step 3), so it produces files the launcher can check.

## 5. Benchmarks

Suite definitions live in `benchmarks/suites/<suite>/suite.yaml`, which pins the harness version, dataset revision, subset, sampling settings and scoring. `bench` starts the recipe, or uses a running one, then runs the pinned harness in its own Python environment against the recipe's endpoint. Most standard harnesses are Python.

Every run records the recipe id and commit, resolved params, inventory fingerprint, engine and weight pins, and timestamps, with raw per-request results. Results go under `hardware/.../<recipe>/benchmarks/results/<date>-<suite>/` using the `run-config.json`, raw, and `summary.json` pattern the Needle repo already uses. The shared runner talks only to the endpoint, so it is engine agnostic. An engine repository's own `evidence/` backs its README. Results here are runs made through the launcher, so they are comparable across recipes.

Suites are selected by `purpose`. Each suite has a smoke tier (a fixed small subset for every change) and a card tier (full run, comparable to model-card numbers).

| Suite | Applies to | Contents |
| --- | --- | --- |
| **perf** | All recipes | TTFT, prefill and decode tok/s, and end-to-end latency at the recipe's declared contexts and output lengths. The P100 contract (32K/65K, 1,024 output tokens, code and prose) is a good template. Power where measurable. Includes warm-up rules and repeat counts. |
| **fidelity** | All recipes | Engine against a reference implementation of the same weights: top-1 agreement, KL, and forced-token logprob on fixed prompts. This is the "faster without quality loss" check that the P100 `tf_gate` and Needle host logit drift already implement. |
| **tool-calling** | `tool-calling`, `routing` | The model card's own suite comes first. [Needle 3 reports](https://github.com/cactus-compute/needle#benchmarks) BFCL v4 (AST match, 3,641 rows), Mobile Actions (exact call, 961 rows), DroidCall (exact calls in order, 200 rows), DSTC8 (field F1, 1,813 turns) and SNIPS (gold and 7-way, 700 rows). Its chart includes an 8-layer subnetwork, the same depth as our recipe. For larger models: [BFCL](https://gorilla.cs.berkeley.edu/leaderboard.html) and [τ²-bench](https://github.com/sierra-research/tau2-bench). [JevBench](https://github.com/fstandhartinger/jevbench) public tier as a secondary check. |
| **general** | `general` | MMLU-Pro, GPQA Diamond, IFEval, and AIME via [lm-evaluation-harness](https://github.com/EleutherAI/lm-evaluation-harness) or the harness the model card used. |
| **coding** | `coding` | [LiveCodeBench](https://livecodebench.github.io/), [EvalPlus](https://github.com/evalplus/evalplus) (HumanEval+ and MBPP+), Aider Polyglot, and SWE-bench Verified with a minimal agent scaffold as a card-tier-only item. General and coding models also run tool-calling (BFCL, τ²-bench). The first targets are the Spark Qwen 3.8 Flash recipes, and Qwen 3.8 27B when P100 resumes. |
| **taste** | Opt-in placeholder | For example SVG or scene generation, style imitation, and design critique, judged by people or a panel. The suite exists as `benchmarks/suites/taste/` with a README and interface, so results can attach later. It is never merged into quality scores. |

Notes that shape the runner:

- **Needle's tools are compiled into firmware** (`tools_schema.h.in`), so BFCL cannot run on the device with arbitrary schemas. Run BFCL on the host build of the same C engine (`host/`) for quality. On the device, measure speed and the frozen task set. Upstream scores come from Cactus's shipped CQ2 binary with a confidence gate, which our firmware does not implement (`confidence: null`). So our device results are compared against our own host-engine run of the same `.cact`, with the card numbers shown as context. SNIPS 7-way (intent) and BFCL relevance/irrelevance are the closest public measures of "decisions"; a routing-specific suite stays open.
- **Throughput limits the card tier on slow hardware.** At roughly 20 tok/s, full SWE-bench or LiveCodeBench runs take days. The card tier is resumable and sharded, and summaries always state subset size.
- **Scores need a reference.** Compare against the same model on a reference engine, such as unquantized weights on vLLM on a Spark, using the same sampling and thinking settings. Model-card numbers are context, since settings often differ.
- **Harness versions and dataset revisions are pinned** in the suite definition, so a score is reproducible.

## 6. Engine repositories: native format and adapters

Engines live in their own repositories and this one links them. An engine repository therefore has to be something a stranger can clone, understand and launch non-interactively. Our current repositories aren't in that shape; they are autoresearch workspaces whose research history, agent tooling and results sit next to the engine. Before our own engines are listed here, we restructure them in their own repositories. We can't do that for anyone else's work, so other repositories are driven by an adapter kept in this repository.

### Native engine format

Our own engines follow this format. Contributors building an engine for this project are encouraged to follow it too, but it is optional: anything else is driven by an adapter.

```
README.md        what it runs, on which hardware, measured results with links to evidence, limits
LICENSE NOTICE   this repo's license, plus upstream code, weights and patch authors
pins.json        upstream commits, weight revisions and SHA-256, toolchain and image digests
<entry points>   setup, fetch, build, deploy, serve, health, stop (Makefile targets or scripts/)
<source>         engine code (any language), firmware, kernels, patches as git history
bench/           engine-specific workloads and the fidelity check against a reference
evidence/        curated runs that back README numbers (run-config, raw, summary)
docs/            design notes worth keeping
```

Rules for the entry points:

- **Non-interactive.** Steps take their inputs from `IE_*` variables with defaults, never prompts, and are safe to rerun.
- **Nothing hard-coded per machine.** No per-machine paths, users, hosts or serial ports.
- **No driver installs or system changes inside steps.** Prerequisites such as a driver branch or ESP-IDF version are checked and reported, and documented for the user to install.
- **Serving.** `serve` stays in the foreground and exposes OpenAI-compatible `/v1/models` and `/v1/chat/completions` plus `/health`. Where it can, it also exposes Prometheus `/metrics` or OTLP.
- **Builds from source by default.** Prebuilt binaries such as firmware images are published as release assets with SHA-256, not committed to the tree.

**Research history is archived, not rewritten.** Before cleanup, tag the current state (for example `research-archive-2026-09-27`) and push research branches. `main` then carries only the engine and curated evidence. Published history is not rewritten; the README links the archive tag so the full record stays reachable.

### Adapters for repositories we don't control

Most external recipes, including every Spark recipe on the list, are shell scripts and `.env` files written for their author's machines. We run them as published and keep the conversion here:

```
hardware/gb10-dgx-spark/qwen3.8-flash-next/mia-tp2/
  recipe.yaml        # source pinned by commit, integration: adapter
  adapter/
    upstream.lock    # SHA-256 of every upstream file the adapter calls or reads
    fetch.sh         # runs their download.sh
    serve.sh         # writes their .env from IE_* values, then runs their start.sh
    stop.sh          # calls their stop.sh, or stops the container by name
    patches/         # only when unavoidable; minimal, under the upstream license
```

The manifest for that recipe, abbreviated. Values come from the upstream README; `TODO` marks what the skill or a person must still pin.

```yaml
id: qwen3.8-flash-next/gb10-dgx-spark/mia-tp2
status: unverified
purpose: [general, coding]
attribution:
  authors:
    - {name: Mia AI Lab, url: https://github.com/MiaAI-Lab, role: author}
    - {name: getrefined, url: https://github.com/getrefined/Qwen3.8-Flash-Next-NVFP4-vLLM-DGX-Spark, role: derived-from}
  source:
    repo: https://github.com/MiaAI-Lab/Qwen3.8-Flash-Next-Dual-DGX-Sparks
    commit: TODO
    license: AGPL-3.0-or-later
    relationship: linked
    integration: adapter
  components:
    - {kind: engine, name: vllm/vllm-openai:qwen38-flash-next, digest: TODO, license: Apache-2.0}   # vLLM's license; other image contents TODO
    - kind: weights
      name: nvidia/Qwen3.8-Flash-Next-NVFP4
      revision: TODO
      license: [NVIDIA Open Model License, Qwen Community License 1.0]
      terms: {gated: false, commercial: TODO, summary: TODO}
runtime:
  isolation: container        # docker
  privileges: [docker-group]
  network: {listen: "0.0.0.0:8888", auth: TODO}
  downloads: [{what: checkpoint, approx_bytes: 142807662592}]   # ~133 GB, copied to the worker by rsync or NFS
hardware:
  targets: [{kind: gpu, match: {model: GB10}}]
  topology: {nodes: 2, devices_per_node: 1}
roles: {head: [serve], worker: [serve]}   # workers start first
env_map:
  HEAD_IP: ${IE_NODE_0_ADDR}
  WORKER_IP: ${IE_NODE_1_ADDR}
  IFACE: ${IE_INV_IFACE}
  IB_HCA: ${IE_INV_IB_HCA}
steps:
  fetch: ${IE_ADAPTER_DIR}/fetch.sh    # runs their download.sh
  serve: ${IE_ADAPTER_DIR}/serve.sh
  stop:  ${IE_ADAPTER_DIR}/stop.sh
endpoint: {protocol: openai, port: 8888}
telemetry: {metrics: {format: prometheus, path: /metrics}}
```

The upstream also offers an abliterated checkpoint behind `ABLIT=1`, which is gated and has its own terms. It would become a profile whose component carries `acknowledge: required`.

What the adapter does:

- **Fetch.** The launcher clones the upstream repository at the pinned commit into `$IE_WORK_DIR/src/<recipe>`. Adapter steps run in that checkout with `IE_ADAPTER_DIR` pointing back to our folder. The checkout is never committed here and is never pushed anywhere.
- **Configuration.** The adapter translates our inventory and parameters into their variable names, flags and config files. `env_map` covers the simple cases; a script handles the rest.
- **Topology.** It maps their head and worker scripts onto our roles and ranks, in the start order they require.
- **Lifecycle.** It fills gaps in the upstream scripts.
  - Many `start.sh` scripts start a detached container and exit. The adapter's `serve` then follows the container logs in the foreground, so the launcher can supervise it.
  - With no `stop.sh`, the adapter stops the container by name.
  - With no health route, it probes the port or `/v1/models`.
- **Endpoint and telemetry.** It records the endpoint and metrics the upstream actually exposes. It does not wrap them in a proxy unless the recipe needs one to be usable.

Keeping it from breaking silently:

- **Checked before every run.** Before running, the launcher checks the upstream files against `upstream.lock`. On a mismatch it stops with "upstream changed; adapter needs review" instead of running something unknown.
- **Drift check on demand.** A launcher command (`upstream <id>`) fetches the upstream's latest commit and reports whether files the adapter depends on have changed. Bumping a pin is a reviewed PR that re-verifies the recipe; until then, the recipe keeps its old pin.
- **Small adapters.** Adapters stay as small as possible so they are easy to repair. When the upstream's own scripts cover a step, the adapter calls them rather than reimplementing it.

Respect for the owners:

- We don't edit their repository or ask them to change it.
- Adapter code is ours under MIT. Any patch applied to their files follows their license, and patches are listed in `recipe.yaml`.
- If a patch fixes a real bug, we may offer it upstream as an issue or PR, as a courtesy and never as a condition for listing.
- Removal requests are honored.

### Needle 3 on ESP32 (`iammrduncan/esp32-needle-3`)

Current state:
- 432 tracked files, 281 of them under `.auto/`: experiments, handoffs, candidate patches and launch scripts.
- About 18 MB of committed firmware images, bootloaders, videos and posters.
- Research-only firmware sources (`kbench.c`, `thermal_diag.c`, `exp_pairs.h`) alongside the shipping app.
- An `autoresearch/decode-tps-2026-09-18` branch.
- Its Makefile already covers most steps (`setup`, `model`, `build`, `flash`, `serve`), and its provenance (`NOTICE`, `model/manifest.json`, `benchmarks/config.json`) is good.

Changes, made in that repository:

1. **Archive, then remove from `main`.** Tag the current tree and archive the research branch. Remove `.auto/` from `main`, moving `SHUTDOWN-HANDOFF.md` and the experiment ledger into `docs/engine-bible/`, which stays.
2. **Ship the matrix firmware.** Decided: the recipe uses `benchmarks/assets/needle-matrix.bin` (6.15 tok/s, 11/12 exact calls; SHA-256 `4a89784b…4451eb6`). The unpromoted 6.22 tok/s B1w3 tree stays in the research archive. `benchmarks/config.json` describes this image only as "B1w3 with archive-bounded PSRAM tier copy", with no source commit, unlike the baseline image. So commit that source to `main` and record the commit. Then confirm the build reproduces the image, or record why it differs, for example build paths or timestamps.
3. **Make layers a real parameter.** Add `LAYERS` (2–8, default 8). `fetch` downloads the pinned 20-layer archive and runs `slice_cact.py --layers $LAYERS`, and `model/manifest.json` records the output hash for each depth.
4. **Parameterize ports and add missing steps.** Take `FLASH_PORT` and `SERIAL_PORT` from `IE_PORT_FLASH` and `IE_PORT_SERIAL`, and the bridge's `--port` (default 8081) from `IE_HTTP_PORT`. Add `health` and `stop`. Move `install-service` out of the launch path; it is an optional extra.
5. **Add OpenAI-compatible routes to `tools/serial_api.py`.**
   - Map `/v1/chat/completions` with `tools` onto the existing `/agent`, `/route` and `/complete` routes, and add `/v1/models`.
   - Document the limit: tool schemas are fixed at firmware build time, so requests naming other tools are rejected clearly.
   - Export the firmware's `EVT prefill` and `EVT done` timings on Prometheus `/metrics`.
6. **Take research code out of the default build.** Keep `kbench.c` and `thermal_diag.c` behind their existing build options, or move them under `research/`, so the default firmware is only the shipping app.
7. **Move binaries to releases.** Move `benchmarks/assets/*.bin` to a GitHub release with hashes in `benchmarks/config.json`, so the rerunnable package fetches them. Reduce or release-host the large media.
8. **Refresh the README.** Keep the measured results with evidence links, lead with the run steps, and keep the scope and limits section.

### P100 (deferred)

The P100 work stays out of this rollout. One risk to address before it resumes: the final engine (`a5a022a` in `FINAL-STATE.md`) exists only in a container worktree, `/workspace/exl3-runtime/engine-v2`. The `p100-work` repository holds just an early 4-commit patch export. Pushing that engine history to a fork keeps the results reproducible whenever the P100 work picks up again.

## 7. Rollout order

Each step lists what "done" means.

1. **Schema and docs.** Add `schema/recipe.schema.json` and documentation for the manifest and the native engine format. Update `AGENTS.md`, `launcher/README.md` and `benchmarks/README.md`: the commands become id-based (`up <id>`, `bench <id>`) rather than `<hardware> <model>`.
   Done when the Needle example manifest and one Spark adapter manifest validate against the schema.
2. **Restructure the Needle 3 repository**, in that repository, as described in section 6. This can run in parallel with step 3.
   Done when a fresh clone of the release commit runs `setup` through `serve` with only `IE_*` variables, and serves `/v1/chat/completions`.
3. **Launcher MVP.** Build `list`, `show`, `check`, `up`, `down`, `status` and `validate` with the local executor, for single-node GPU and MCU recipes. Add tests for manifest validation, topology matching, the step environment, and the disclosure and acknowledgment flow.
   Done when the tests pass and `check` prints a correct run plan for the Needle recipe.
4. **Needle 3 as the first recipe.** It is public and all three licenses are known: Apache-2.0 for the engine repo, the needle-2-esp32 upstream, and the weights. Write `recipe.yaml` linked to the cleaned repository's release commit, then launch it with `up` on a real ESP32-S3.
   Done when evidence is committed here and the status is `verified`.
5. **One external Spark recipe through an adapter.** Start with single-Spark Mia Qwen 3.8 Flash (TP=1), then a dual-Spark recipe with the SSH executor. Ask Mia AI Lab whether they are comfortable being run this way. Then write the `/add-recipe-from-link` skill and use it on the remaining Spark links, which land as `unverified` until run.
   Done when both recipes launch through their adapters, `upstream.lock` blocks a modified checkout, and `upstream <id>` reports drift.
6. **Benchmark runner.** Start with perf and fidelity, then tool-calling for Needle (the model card suite on the host engine, plus device perf), then general and coding smoke tiers on a Spark recipe. Add the taste placeholder.
   Done when each suite has a pinned `suite.yaml` and at least one committed run.

## Implementation status (2026-09-28)

1. **Schema and docs: done.**
   - `schema/recipe.schema.json` and `docs/recipe-format.md`; `AGENTS.md`, the root README and the launcher and benchmarks READMEs are updated.
   - Both manifests validate: Needle, and the Spark draft.
2. **Needle repository restructure: done and pushed.**
   - Branch `launcher-format` (`9d2987b`) sits on top of `443b6bd`, and the archive tag `research-archive-2026-09-27` is on GitHub.
   - A fresh clone from GitHub runs every step from `scripts/ie-step.sh` with only `IE_*` variables, and serves `/v1/chat/completions`.
   - Optional, for the owner: merge the branch into `main`, and upload the ten benchmark assets staged in `esp32-needle-3-release-assets/` as the `benchmark-assets-2026-09-27` release. The engine repo's own benchmark package needs that release; the recipe doesn't.
3. **Launcher MVP: done.**
   - `list`, `show`, `check`, `up`, `down`, `status`, `validate`, `upstream`, `suites`, `bench`, `inventory`, plus the `--otel` collector sidecar.
   - `npm test` runs 27 tests, including end-to-end runs on the local executor.
   - The SSH executor has only been unit-tested.
4. **Needle as the first recipe: verified.**
   - It was fetched from GitHub at the pinned commit and run through `up` on a real ESP32-S3, with a clean catalog.
   - Evidence: tool-calls 11/12 exact, decode 6.156 tok/s, fidelity max delta 5.3e-05. All three match the engine repo's recorded run.
5. **External Spark recipe: handed off.**
   - The draft manifest and [`HANDOFF.md`](../hardware/gb10-dgx-spark/qwen3.8-flash-next/mia-tp2/HANDOFF.md) are ready for an agent working on two DGX Sparks.
   - The `/add-recipe-from-link` skill is written (`.claude/skills/add-recipe-from-link/`).
   - Mia AI Lab has not been contacted; that's the owner's call.
6. **Benchmark runner: partly done.**
   - `perf`, `fidelity` and `tool-calls` are ready and have run on Needle.
   - `tool-calling-card`, `general` and `coding` are defined with pinned harnesses but have not run. They need a model that can take arbitrary tool schemas (Needle's are compiled in) or a general LLM endpoint, which means the Spark recipe.
   - `taste` is a placeholder.

## Open questions

- The taste suite design is deferred.
