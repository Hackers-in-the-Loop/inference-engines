---
name: add-recipe-from-link
description: Turn a link to someone's published model/engine recipe (a GitHub repo for a specific device and model) into a recipe in this repository, with full attribution, a runtime disclosure, and an adapter that drives their repo as published. Use when the user gives a recipe link and asks to add, import or list it.
---

# Add a recipe from a link

The user gives you a URL to someone else's recipe, usually a GitHub repository for one model on one kind of hardware. Your job is to add it to this catalog **without changing their work**. You write a manifest and, if needed, an adapter in this repository, and it lands as `status: unverified`.

Read first: `docs/recipe-format.md` (the format), `docs/rollout-plan.md` sections 2 and 6 (why), and one existing recipe, e.g. `hardware/gb10-dgx-spark/qwen3.8-flash-next/mia-tp2/`.

## Rules

- **Never edit, fork or open anything on the upstream repository, and never contact the author.** At the end, suggest a courtesy note to the user; they decide.
- **Never guess.** Any license, pin, size, flag or behaviour you can't confirm from the source stays `TODO`. A wrong license is worse than a `TODO`.
- **Never claim it runs.** Only someone who ran it on the listed hardware may change `status` from `unverified`.
- **Keep third-party content out of this repo.** Don't copy their code, weights or large files here. The adapter calls their scripts from the pinned checkout.

## Steps

1. **Resolve and pin.** Normalize the URL to the repository. Pin the current default-branch commit with `git ls-remote <repo> HEAD`, which records the full 40-hex SHA. Clone it read-only into a scratch directory at that commit.
2. **Check for duplicates.** Run `npm run launcher -- list` and look under `hardware/<hardware>/`. If a recipe for the same model on the same hardware exists, apply the listing rule: add this one only if it covers something the existing one doesn't, or credibly performs better. If you're unsure, stop and ask the user.
3. **Read everything that matters.** That means `LICENSE`, `NOTICE`, the README, docs, model cards of every checkpoint it downloads, `.env` samples, and every launch script (`start.sh`, `download.sh`, Dockerfiles, compose files). Note:
   - who wrote it, and what it derives from (credit those too, `role: derived-from`);
   - the code license (SPDX), and each component's license: engine or image, weights, drafter or speculator, patches, kernels;
   - gated checkpoints, non-commercial or research-only terms, share-alike terms. Each of these gets `acknowledge: required` and a plain-words `terms.summary`;
   - what the scripts actually do to the machine: container or host, sudo, packages or drivers installed, services, NFS, sysctl, firewall, devices flashed, listen address and auth, download sizes. This becomes `runtime`, and it must be accurate.
4. **Classify.**
   - `hardware.targets` and `topology`: nodes and devices per node; multi-node needs `roles`.
   - `purpose`, `endpoint` (port, served model name, OpenAI-compatible or not), `telemetry` (does it expose `/metrics`?).
   - The site-specific variables their scripts need (IPs, interfaces, HCAs, ports), which map to `env_map` or adapter logic.
5. **Write the recipe** under `hardware/<hardware>/<model>/<author-or-variant>/`:
   - `recipe.yaml` with `relationship: linked`, `integration: adapter` (or `native` if their repo already follows the native engine format in `docs/recipe-format.md`), and `status: unverified`. Put every author and component in `attribution`.
   - `adapter/` with `fetch.sh`, `serve.sh`, `stop.sh` and `upstream.lock` if you can write them from the source alone.
     - Adapters translate `IE_*` values into their `.env` and flags and call their scripts.
     - `serve.sh` must stay in the foreground; if their start script detaches, follow the container logs.
     - `upstream.lock` is `sha256sum` output for every upstream file the adapter calls or reads, relative to their repo root.
   - If the adapter can't be finished without the hardware, write `HANDOFF.md` instead, listing exactly what the person with the hardware must do. The Spark recipe's `HANDOFF.md` is the model to follow.
6. **Validate.** `npm run launcher -- validate` must report 0 problems. `npm run launcher -- show <id>` should read correctly. If you have a matching inventory, `npm run launcher -- check <id>` prints the run plan; confirm that it discloses what their scripts really do.
7. **List it.** Add a line to the hardware folder's awesome list or README under the right heading, crediting the author and linking their repository.
8. **Hand back.** Summarize for the user: the author and license of each component, any `acknowledge: required` terms, any `TODO`s left and why, what the run plan discloses, and what's needed to verify it. Offer to open a PR. Suggest they send the author a courtesy note, and remember that removal requests are always honoured.
