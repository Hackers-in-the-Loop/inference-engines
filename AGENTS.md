# Agent instructions

## Project

Inference Engines collects reproducible model and engine recipes for specific hardware. The aim is to improve speed while checking model quality, provide an OpenAI compatible serving endpoint, and export inference telemetry with OpenTelemetry. Engines live in their own repositories; this repository is the catalog, launcher and benchmark runner that brings them together. The format is in `docs/recipe-format.md` and the reasoning and rollout in `docs/rollout-plan.md`.

## Repository map

- `hardware/<hardware>/<model>/<recipe>/`: recipes (`recipe.yaml`, optional `adapter/`, `benchmarks/`).
- `schema/recipe.schema.json`: the manifest schema.
- `launcher/`: the launcher and benchmark runner (Node ≥ 23.6, TypeScript run directly). See `launcher/README.md`.
- `benchmarks/`: suite definitions (`benchmarks/suites/<name>/suite.yaml`). See `benchmarks/README.md`.
- `docs/`: `recipe-format.md` (reference) and `rollout-plan.md` (design and rollout).
- `.claude/skills/add-recipe-from-link/SKILL.md`: procedure for importing someone else's recipe from a link. Agents without skill support should follow that file directly.
- `README.md`: project overview, current status, and community links.

## Working conventions

- Inspect the repository before assuming a command or recipe exists. `npm run launcher -- <command>` and `npm test` are implemented; check `npm run launcher -- --help` for the current commands. Suites marked `defined` or `placeholder` in `benchmarks/suites/` have not been run.
- Run `npm run launcher -- validate` and `npm test` after changing recipes, the schema or the launcher.
- Never edit or open anything on an upstream repository you don't own, and never contact its author on the owner's behalf. External recipes run as published, through an adapter in this repository.
- Only change a recipe's `status` from `unverified` after running it on the listed hardware and committing the evidence.
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
