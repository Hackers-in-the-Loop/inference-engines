# Recipe format

This is the reference for recipe manifests, the launcher's step contract, and the two ways a recipe can drive an engine. [`schema/recipe.schema.json`](../schema/recipe.schema.json) is the authority; `npm run launcher -- validate` checks every recipe against it plus the rules below. The reasoning behind the design is in the [rollout plan](rollout-plan.md).

## Layout

```
hardware/<hardware>/<model>/<recipe>/
  recipe.yaml        manifest
  NOTICE             only if the recipe carries patches or third-party code
  adapter/           only for integration: adapter (see below)
  benchmarks/        workloads and committed results
```

A recipe's `id` is `<model>/<hardware>/<variant>`, for example `needle3/esp32-s3/8-layer`, plus optional `aliases`. The launcher builds its name map by scanning `hardware/**/recipe.yaml`; `validate` rejects duplicate ids and aliases.

## Manifest fields

| Field | Required | Meaning |
| --- | --- | --- |
| `schema` | yes | Always `1`. |
| `id`, `aliases`, `title` | id, title | Names. |
| `status` | yes | `unverified`: not run here yet. `experimental`: runs here, but evidence is incomplete or results unstable. `verified`: run here on the listed hardware, fully pinned, with committed `evidence`. `deprecated`: hidden from `list` by default. |
| `purpose` | yes | Selects benchmark suites: `tool-calling`, `routing`, `general`, `coding`, `image`, `video`, `audio`, `embedding`. |
| `attribution.authors` | yes | Everyone credited, each with a `role`: `author`, `maintainer`, `upstream-engine`, `model`, `patches`, `kernels`, `drafter`, `derived-from`. |
| `attribution.cite` | no | Upstream citation blocks, reproduced as given. |
| `attribution.source` | yes | `repo`, `commit` (40-hex; `TODO` only while unverified), `license` (SPDX), `relationship` and `integration` (below). |
| `attribution.components` | no | Every third-party piece the recipe pulls in: engine, weights, drafter, patches, kernels, image, dataset. Each has `license`, pins (`commit`, `revision`, `digest`, `sha256`) and `terms`. |
| `runtime` | yes | The disclosure block the run plan is built from (below). |
| `hardware.targets` | yes | Device `kind` (`gpu`, `mcu`, `cpu`, `apple-silicon`, `npu`), a `match` predicate against inventory properties, and the serial `ports` roles an MCU needs. |
| `hardware.topology` | yes | `nodes`, `devices_per_node`, and optional named `variants`, which are exposed as profiles. |
| `roles` | multi-node | The steps each role runs: `head` is rank 0, workers are the other ranks. |
| `params`, `profiles` | no | Parameters with defaults and allowed values, exported as `IE_PARAM_<NAME>`, and named presets of them. |
| `toolchain` | no | Prerequisites, each with an optional `check` command that `check` runs. Steps never install them. |
| `env_map` | no | Upstream variable names filled from `IE_*` values, for example `HEAD_IP: ${IE_NODE_0_ADDR}`. |
| `steps` | serve | `setup`, `fetch`, `build`, `deploy`, `serve`, `health`, `stop`. Each is a shell command run in the pinned checkout. |
| `endpoint` | yes | `protocol` (`openai` or `custom`), `port`, `model`, `extra_routes`, `limits`. |
| `telemetry` | no | `metrics: {format: prometheus, path}` for the engine's own metrics, or a `log_parser`. |
| `benchmarks` | no | `workloads` (file in the recipe folder), `fidelity` (command in the checkout), and `engine_metrics`, which maps `decode_tokens`, `decode_ms`, `prefill_tokens` and `prefill_ms` to the engine's metric names. |
| `evidence` | verified | Committed result folders that back the status. |

### Relationship and integration

`relationship` describes how the code relates to this repository:

- `linked`: fetched at the pinned commit and never edited in place.
- `forked`: a fork we maintain, which carries upstream `NOTICE` and `LICENSE`.
- `vendored`: copied into this repository.
- `reference`: listed only; the launcher refuses to run it.

`integration` describes how the steps drive the code:

- `native`: the upstream repository follows the native engine format, and steps call its entry points.
- `adapter`: steps call scripts in this recipe's `adapter/` folder, which drive the upstream repository as published.

### Terms and acknowledgment

Components that are gated, non-commercial or share-alike must set `acknowledge: required`; the schema rejects them otherwise. They are allowed in verified recipes.

- **Before running.** The launcher shows the license and a plain-words `terms.summary` before anything runs. The user must type the component name, or pass `--accept <name>`; `--yes` never covers license terms.
- **Stored per terms.** Acknowledgments are stored per recipe, component and a hash of its terms, and requested again when those change.
- **No accepting on the user's behalf.** For gated weights, the user accepts on the host site and supplies their own token. The launcher never accepts a license for them.
- **Profile-only components.** Components that only some profiles use list those `profiles`.

### Runtime disclosure

`runtime` states how the recipe really runs, so nobody has to read a `start.sh` to find out:

| Key | Contents |
| --- | --- |
| `isolation` | `container` (with `container.image` and `digest`), `vm`, or `host`. Host execution gets a warning in the run plan; no extra acknowledgment is needed. |
| `privileges` | For example `sudo`, `docker-group`, `serial-device-access`. |
| `device_writes` | For example `flash-erase-and-write`. |
| `network` | `listen` address and `auth`. |
| `downloads` | Approximate sizes of what gets fetched. |
| `host_changes` | Packages, drivers or services installed. |
| `steps` | Per-step isolation overrides, for example building in a container and flashing on the host. |

## Launcher step contract

For every placed node, before any step, the launcher:

1. holds each device's `lock` file (flock) for the whole run;
2. clones `source.repo` at `source.commit` into `$IE_WORK_DIR/src`;
3. for adapter recipes, copies `adapter/` to `$IE_WORK_DIR/adapter` and checks `adapter/upstream.lock`.

Steps then run in order in the checkout. A step is a shell command; exit code 0 means success.

- `serve` stays in the foreground. The launcher runs it in its own process group, logs it, and stops it with SIGTERM to that group, or with the `stop` step when the recipe defines one.
- Readiness is the `health` step, or else `GET /v1/models` (OpenAI endpoints) or `/health`.
- Multi-node: workers start serving before the head.

Environment provided to every step:

| Variable | Meaning |
| --- | --- |
| `IE_RECIPE_ID`, `IE_RECIPE_DIR` | Recipe id and its folder in this repository |
| `IE_WORK_DIR`, `IE_SRC_DIR`, `IE_ADAPTER_DIR` | Per-recipe cache, pinned checkout, adapter copy |
| `IE_PARAM_<NAME>` | Resolved params |
| `IE_HTTP_PORT` | Port the endpoint listens on |
| `IE_NODE_RANK`, `IE_NODE_COUNT`, `IE_ROLE` | This node's place in the topology |
| `IE_NODE_<n>_ADDR` | Address of node `n` (`attrs.ADDR`, else the SSH host, else loopback) |
| `IE_DEVICES` | Local device indices; also set as `CUDA_VISIBLE_DEVICES` or `HIP_VISIBLE_DEVICES` |
| `IE_PORT_<ROLE>` | Serial port per role, for MCUs |
| `IE_INV_<NAME>` | This host's inventory `attrs` |
| `IE_OTEL_EXPORTER_OTLP_ENDPOINT` | Set when `OTEL_EXPORTER_OTLP_ENDPOINT` is set for the launcher |

## Inventory

`~/.config/inference-engines/inventory.yaml` describes your machines and is never committed; see [`launcher/inventory.example.yaml`](../launcher/inventory.example.yaml).

- `inventory --probe` prints what it can detect (GPUs, serial ports) without opening any board.
- `--on <host|label>` limits placement to specific hosts or devices.
- A device's `lock` should point at the same file every other tool uses for that device, so runs never collide.

## Native engine format

Engine repositories we maintain follow this format. It is optional for contributors: anything else gets an adapter.

```
README.md        what it runs, on which hardware, measured results with evidence links, limits
LICENSE NOTICE   this repo's license, plus upstream code, weights and patch authors
pins.json        or equivalent manifest: upstream commits, weight revisions and hashes, toolchain and image digests
<entry points>   setup, fetch, build, deploy, serve, health (Makefile targets or scripts)
<source>         engine code in any language, firmware, kernels, patches as git history
bench/           engine-specific workloads and the fidelity check
evidence/        curated runs behind README numbers
```

Entry points are non-interactive and take their inputs from `IE_*` variables with defaults. They are safe to rerun, contain no machine-specific values, and never install drivers or change the system. `serve` stays in the foreground, exposes OpenAI `/v1/models` and `/v1/chat/completions` plus `/health`, and exposes Prometheus `/metrics` where it can. Builds work from source; prebuilt binaries are release assets with hashes.

## Adapters

An adapter lets us run someone else's repository exactly as they published it:

```
adapter/
  upstream.lock    sha256sum lines for every upstream file the adapter calls or reads
  fetch.sh serve.sh stop.sh ...   translate IE_* into their .env, flags and scripts
  patches/         only when unavoidable; minimal, under the upstream license
```

- `up` refuses to run if the checkout doesn't match `upstream.lock`.
- `upstream <id>` reports whether the upstream default branch has changed those files since the pin. Bumping a pin is a reviewed change that re-verifies the recipe.
- Adapter code is ours under MIT; patches to upstream files keep the upstream license.
- We never edit the upstream repository or ask its owner to change it.
