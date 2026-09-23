# Inference Engines

Reproducible model and inference engine recipes for different hardware, from Hackers in the Loop.

We use automated research and measurements to improve inference speed while checking that model quality holds up. The first projects are [Needle 3 on ESP32](https://github.com/iammrduncan/esp32-needle-3) and unpublished Qwen 3.8 27B work on P100. This repository is where we are bringing those experiments together as repeatable recipes.

## Project status

This repository is an early scaffold. The hardware folders are placeholders; there are no runnable recipes, launcher implementation, benchmark suite, or `package.json` here yet. The intended workflow is to download the right weights, apply any required conversions or changes, launch an OpenAI compatible endpoint, and capture inference details through OpenTelemetry. Each recipe should include the commands and evidence needed to reproduce its results.

## Repository layout

| Path | Purpose |
| --- | --- |
| `hardware/` | Recipes grouped by hardware, then model as they are added. |
| `launcher/` | Planned common entry point for launching a recipe. |
| `benchmarks/` | Planned benchmark runner and recipe results. |

The current hardware placeholders cover B60, BC-160, ESP32, GB10/DGX Spark, Apple M-series Macs, P100, Radeon VII, and V100. A placeholder does not mean a recipe has been tested or published here.

## Contributing

Start with [AGENTS.md](AGENTS.md) for the repository conventions. For a new recipe, document the exact hardware and model, upstream sources and licenses, setup and launch steps, endpoint behavior, and benchmark method and results. Please distinguish measured results from goals or estimates.

## Community

- [Hackers in the Loop website](https://hackersintheloop.org)
- [Join the Discord](https://discord.gg/3Qs2uejUf9)

## License

This repository's original content is licensed under the [MIT License](LICENSE). Referenced models, weights, engines, and other third-party components retain their own licenses.
