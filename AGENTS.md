# Agent instructions

## Project

Inference Engines collects reproducible model and engine recipes for specific hardware. The aim is to improve speed while checking model quality, provide an OpenAI compatible serving endpoint, and export inference telemetry with OpenTelemetry. The repository is currently a scaffold: its hardware directories contain placeholders, and neither the launcher nor benchmark runner is implemented.

## Repository map

- `hardware/<hardware>/<model>/`: home for a hardware and model recipe as it is added.
- `launcher/`: planned shared launcher. See `launcher/README.md`.
- `benchmarks/`: planned benchmark runner and results. See `benchmarks/README.md`.
- `README.md`: project overview, current status, and community links.

## Working conventions

- Inspect the repository before assuming a command or recipe exists. Do not present planned `npm run` commands as runnable until there is a corresponding implementation and package script.
- Keep setup and launch steps reproducible. Record hardware details, model and weight revisions, engine version, dependencies, flags, and required environment variables. Do not commit credentials or downloaded model weights by default.
- For performance work, state the workload and measurement method, preserve raw results where practical, and check quality as well as speed. Label unmeasured claims as goals or estimates.
- Keep endpoint and telemetry documentation aligned with working code. Specify actual routes, payloads, and exported signals when they are implemented.
- Add focused verification for implemented behavior, and run the checks relevant to the files changed. Do not invent benchmark numbers or claim hardware validation without running it.
- Preserve attribution and applicable licenses for upstream code, models, and weights. The repository MIT license covers original content here; it does not relicense third-party material. The linked ESP32 project has its own license.
- Update the root and area READMEs when adding a recipe, launcher command, benchmark workflow, or supported configuration.

## References

- [Needle 3 on ESP32](https://github.com/iammrduncan/esp32-needle-3)
- Qwen 3.8 27B on P100 is ongoing, unpublished work. Describe it without linking to its private repository or presenting it as a released recipe.
- [Hackers in the Loop](https://hackersintheloop.org) and [Discord](https://discord.gg/3Qs2uejUf9)
