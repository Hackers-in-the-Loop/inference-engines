# Handoff: adapter for Mia AI Lab's dual-Spark Qwen3.8-Flash-Next recipe

This recipe folder is a draft. The manifest (`recipe.yaml`) validates, but the adapter does not exist yet and nothing here has run on a DGX Spark. Whoever picks this up needs two DGX Sparks connected over their ConnectX (QSFP) link, and should work through the list below. Read [`docs/rollout-plan.md`](../../../../docs/rollout-plan.md) sections 2, 3 and 6 and [`docs/recipe-format.md`](../../../../docs/recipe-format.md) first.

## What this recipe is

- Upstream: [MiaAI-Lab/Qwen3.8-Flash-Next-Dual-DGX-Sparks](https://github.com/MiaAI-Lab/Qwen3.8-Flash-Next-Dual-DGX-Sparks), AGPL-3.0-or-later, pinned in `recipe.yaml` to `2c86a1d05f93c8d3a68146a321d417ffa4ca5039` (upstream HEAD on 2026-09-27).
- It serves `nvidia/Qwen3.8-Flash-Next-NVFP4` with vLLM in Docker, tensor-parallel across both Sparks (TP=2), on `:8888`.
- Upstream is driven by `.env` and `start.sh`/`stop.sh`/`download.sh`. It takes site-specific inputs such as `HEAD_IP`, `WORKER_IP`, `IFACE`, `WORKER_IFACE`, `IB_HCA`, `WORKER_IB_HCA`, `IB_GID_INDEX` and `MASTER_PORT`. Read `.env.sample` at the pinned commit for the real list.

## Rules

- **Do not edit the upstream repository.** Only open issues or PRs there if the owner asks. Everything we need lives in this folder's `adapter/`. The repo owner will contact Mia AI Lab; don't contact them yourself.
- **Patches last.** Add patches to upstream files only when there is no other way. Keep them minimal, put them in `adapter/patches/`, and list them in `recipe.yaml`. They fall under the upstream license (AGPL). Our adapter scripts are MIT.
- **No guesses.** Anything you can't confirm stays `TODO`. Don't claim results you did not run.
- **No CI.** Nothing in this repo uses it yet.

## Tasks

1. **Set up the launcher machine.**
   - Install Node ≥ 23.6 on the machine that runs the launcher (one of the Sparks is fine). Run `npm install` in this repo.
   - Create `~/.config/inference-engines/inventory.yaml` describing both Sparks, using `launcher/inventory.example.yaml` as the template. You need `address` (`local` or an SSH target reachable with keys, since `BatchMode=yes` is used) and `attrs.ADDR`, the fabric IP the other node uses. Set `IFACE` and `IB_HCA` per host, and give each GPU `kind: gpu`, `model` (matched against `*GB10*`) and `index`.
   - `npm run launcher -- inventory --probe` on each Spark prints what `nvidia-smi` reports, to help fill it in.
2. **Read the upstream scripts at the pinned commit.**
   - Record which files the adapter calls or reads.
   - Note what `start.sh` does on the worker. The upstream README says it orchestrates both nodes, including distribution over rsync or NFS.
   - Decide between two approaches:
     - (a) Let upstream orchestrate from the head, with `roles.worker` reduced to what the worker still needs, or none. This is the recommended approach because it keeps the adapter small.
     - (b) Run per-node steps from our launcher.

   Update `roles` in `recipe.yaml` to match.
3. **Write the adapter.**
   - `adapter/fetch.sh`: runs upstream `download.sh`, which pulls the image and weights. It must be non-interactive and safe to rerun.
   - `adapter/serve.sh`: writes upstream's `.env` from the exported variables (the `env_map` names plus anything else `.env.sample` needs, mapped from `IE_*`). It then runs `start.sh`. Upstream starts detached containers and exits, so after `start.sh` returns, follow the head container's logs (`docker logs -f <name>`) in the foreground. The launcher supervises that process and treats its exit as the server stopping.
   - `adapter/stop.sh`: runs upstream `stop.sh`, or `docker stop` by container name.
   - Add more `env_map` entries or adapter logic for `WORKER_IFACE`, `WORKER_IB_HCA`, `IB_GID_INDEX` and `MASTER_PORT` as needed. Inventory attributes appear as `IE_INV_<NAME>` on each node, and other nodes' addresses as `IE_NODE_<n>_ADDR`.
4. **Write `adapter/upstream.lock`.**
   - It holds the SHA-256 of every upstream file the adapter calls or reads, in `sha256sum` format, with paths relative to the upstream repo root. For example: `cd <checkout> && sha256sum start.sh stop.sh download.sh .env.sample > …/adapter/upstream.lock`.
   - The launcher refuses to run if these files differ, and `npm run launcher -- upstream <id>` reports drift against upstream's latest commit.
5. **Fill in the manifest TODOs:**
   - `runtime.container.digest` and the image component's `digest` (`docker image inspect --format '{{index .RepoDigests 0}}'`).
   - The weights `revision`, from the Hugging Face commit that `download.sh` fetches or pins.
   - License terms (`commercial`, `summary`) for the NVIDIA Open Model License and the Qwen Community License 1.0. Read them; if a term is restrictive, set `acknowledge: required` on that component.
   - `network.auth` and `host_changes`: what `start.sh`/`download.sh` change on the host, such as NFS exports or sysctl.
   - `endpoint.model`: the served model name in `/v1/models`.

   The upstream also offers an abliterated checkpoint behind `ABLIT=1`, which is gated and has its own terms. If you add it, make it a profile, and give its component `profiles: [<name>]`, `terms.gated: true` and `acknowledge: required`.
6. **Run it.**
   - `npm run launcher -- validate` must report 0 problems.
   - `npm run launcher -- check qwen3.8-flash-next/gb10-dgx-spark/mia-tp2` prints the run plan. Review it and confirm it discloses what really happens.
   - `npm run launcher -- up qwen3.8-flash-next/gb10-dgx-spark/mia-tp2 --detach`, then `status`, a manual `curl http://<head>:8888/v1/chat/completions …`, then `down`.
   - The SSH executor has unit tests but has never run against real hosts. Expect to fix launcher bugs; add a test for each fix (`npm test`).
7. **Prove the adapter guards work.**
   - Change one locked file in the node's checkout under `~/.cache/inference-engines/qwen3.8-flash-next__gb10-dgx-spark__mia-tp2/src/`. `up` must refuse with "upstream changed; adapter needs review". Then restore the file.
   - `npm run launcher -- upstream qwen3.8-flash-next/gb10-dgx-spark/mia-tp2` must print the drift report.
8. **Benchmarks.**
   - Add `benchmarks.workloads` to the manifest (the `perf` suite needs prompts; use the P100-style contract: code and prose prompts with fixed output lengths).
   - Run `npm run launcher -- bench <id> --suite perf --tier smoke`, then the `general` and `coding` smoke tiers once those suites are marked `ready`. Commit the result folders under `benchmarks/results/`.
9. **Finish.**
   - Set `status: experimental`, or `verified` if every pin is filled and `evidence:` lists the committed runs; `validate` enforces this.
   - Update `hardware/gb10-dgx-spark/external/spark-awesomelist.md` to link this recipe.
   - Rewrite this file as a short "how this adapter works" note, or delete it once the recipe README covers that.

## Optional warm-up

Mia also publishes a single-Spark (TP=1) recipe, [Qwen3.8-Flash-Next-Single-DGX-Spark](https://github.com/MiaAI-Lab/Qwen3.8-Flash-Next-Single-DGX-Spark), whose upstream HEAD on 2026-09-27 was `b8439110eec0230facbe4ddf0dffe01b8f769be0`. Adapting it first on one Spark exercises the adapter format without the multi-node parts. It belongs in its own folder, `hardware/gb10-dgx-spark/qwen3.8-flash-next/mia-tp1/`.
