# Needle 3 on ESP32-S3 (8-layer matrix firmware)

[Needle 3](https://github.com/cactus-compute/needle) by Cactus Compute, Inc. runs on one ESP32-S3 (16 MB PSRAM, 32 MB flash) as an agent-watch tool router. The engine is [iammrduncan/esp32-needle-3](https://github.com/iammrduncan/esp32-needle-3), derived from [andrisgauracs/needle-2-esp32](https://github.com/andrisgauracs/needle-2-esp32). The code and the weights are Apache-2.0. The manifest is [`recipe.yaml`](recipe.yaml).

```sh
npm run launcher -- check needle3/esp32-s3/8-layer
npm run launcher -- up needle3/esp32-s3/8-layer --detach       # builds, ERASES AND FLASHES the board, serves
npm run launcher -- bench needle3/esp32-s3/8-layer --suite tool-calls
npm run launcher -- down needle3/esp32-s3/8-layer
```

Each step runs in the ESP-IDF v5.5.2 container, with the board's serial port(s) passed through. The bridge listens on `127.0.0.1` without auth and serves OpenAI `/v1/chat/completions`, with the models `needle3` (device tools) and `needle3-router` (capability routes). Tool schemas are compiled into the firmware, so a request can only offer those tools. `--param layers=2..8` selects the model depth.

## Measured on 2026-09-28

These runs used board1 (ESP32-S3 N32R16) on `mbench01`, engine commit `9d2987b`, 8 layers and the smoke tier. The launcher code was uncommitted at the time, so `catalog.dirty` is true in the run configs.

| Suite | Result | Evidence |
| --- | --- | --- |
| tool-calls | 12/12 succeeded, 11/12 exact calls. The miss is `heldout_free_describe` (`get_status` instead of no call), the same output as the engine repo's recorded matrix-v3 run. | [results](benchmarks/results/2026-09-28-tool-calls-smoke/) |
| perf | Firmware-reported decode 6.157 tok/s (mean), 6.198 (pooled); prefill 6.513 tok/s (mean). 193 decode tokens. HTTP latency mean 6.66 s. Non-streaming, because the bridge doesn't stream. | [results](benchmarks/results/2026-09-28-perf-smoke/) |
| fidelity | Host engine against the frozen golden logits: max \|Δ\| 5.3e-05 (gate 0.002), top-1 10/10. | [results](benchmarks/results/2026-09-28-fidelity-smoke/) |

For comparison, the engine repo's matrix-v3 eight-layer run recorded decode 6.1508 and prefill 6.5125 tok/s, with 193 decode tokens and 11/12 exact calls.

The workload is the engine's frozen 12-case project set ([`benchmarks/workload.yaml`](benchmarks/workload.yaml)). It is a project workload, not a public benchmark score. The model-card suite (BFCL v4, Mobile Actions, DroidCall, DSTC8, SNIPS) is defined in `tool-calling-card` but has not been run.

## Status: experimental

The recipe ran here with full pins, but the pinned commit is on the engine repo's `launcher-format` branch, which isn't public yet. Its benchmark binaries also still need to be uploaded as the `benchmark-assets-2026-09-27` release. After both, a run fetched from GitHub will make this `verified`.

On the board used here, the USB-Serial/JTAG ports of all three boards answered esptool with "Write timeout". The inventory therefore flashes over the UART port (`ports.flash` set to the console). That setting is local to this machine, not part of the recipe.
