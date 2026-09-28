# Inference Engines

Reproducible model and inference engine recipes for different hardware, from Hackers in the Loop.

We use automated research and measurements to improve inference speed while checking that model quality holds up. The first projects are [Needle 3 on ESP32](https://github.com/iammrduncan/esp32-needle-3) and unpublished Qwen 3.8 27B work on P100. This repository is where we are bringing those experiments together as repeatable recipes.

## Project status

Engines live in their own repositories; this repository is the catalog, launcher and benchmark runner that brings them together. Each recipe is a `recipe.yaml` manifest that pins its source, credits every author and component with its license, and states exactly how it runs: container or host, privileges, which devices it writes to, and what it downloads. The launcher shows you that plan, and asks you to acknowledge any gated or non-commercial terms, before it runs anything.

| Recipe | Hardware | Status |
| --- | --- | --- |
| [`needle3/esp32-s3/8-layer`](hardware/esp32/needle3/8-layer/) | ESP32-S3, 16 MB PSRAM, 32 MB flash | verified: 6.16 decode tok/s, 11/12 exact calls, fidelity passed |
| [`qwen3.8-flash-next/gb10-dgx-spark/mia-tp2`](hardware/gb10-dgx-spark/qwen3.8-flash-next/mia-tp2/) | 2× DGX Spark | draft; adapter pending ([handoff](hardware/gb10-dgx-spark/qwen3.8-flash-next/mia-tp2/HANDOFF.md)) |

Unpublished Qwen 3.8 27B work on P100 is deferred. The other hardware folders (B60, BC-160, GB10/DGX Spark, Apple M-series Macs, P100, Radeon VII, V100) are placeholders; a placeholder does not mean a recipe has been tested or published here.

## Quick start

Requires Node ≥ 23.6 and git.

```sh
npm install
npm run launcher -- list
cp launcher/inventory.example.yaml ~/.config/inference-engines/inventory.yaml   # then describe your machines
npm run launcher -- check needle3/esp32-s3/8-layer    # run plan and checks; changes nothing
npm run launcher -- up needle3/esp32-s3/8-layer --detach
npm run launcher -- bench needle3/esp32-s3/8-layer --suite tool-calls
npm run launcher -- down needle3/esp32-s3/8-layer
```

See [`launcher/README.md`](launcher/README.md) for every command, and [`benchmarks/README.md`](benchmarks/README.md) for the suites.

## Repository layout

| Path | Purpose |
| --- | --- |
| `hardware/<hardware>/<model>/<recipe>/` | Recipes: `recipe.yaml`, optional `adapter/`, workloads and committed results. |
| `schema/` | The manifest schema. |
| `launcher/` | Launcher and benchmark runner. |
| `benchmarks/suites/` | Benchmark suite definitions with pinned harnesses. |
| `docs/` | [Recipe format](docs/recipe-format.md) and [rollout plan](docs/rollout-plan.md). |
| `.claude/skills/add-recipe-from-link/` | How an agent imports someone else's recipe from a link. |

## Contributing

Start with [AGENTS.md](AGENTS.md) for the repository conventions and [docs/recipe-format.md](docs/recipe-format.md) for the manifest. You can build your own engine in its own repository, following the native engine format if you like, or link someone else's recipe as published through an adapter; the `add-recipe-from-link` skill walks an agent through that. Run `npm run launcher -- validate` and `npm test` before opening a PR, and please distinguish measured results from goals or estimates.

## Community

- [Hackers in the Loop website](https://hackersintheloop.org)
- [Join the Discord](https://discord.gg/3Qs2uejUf9)

## License

This repository's original content is licensed under the [MIT License](LICENSE). Referenced models, weights, engines, and other third-party components retain their own licenses.
