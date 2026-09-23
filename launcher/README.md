# Launcher

This directory is reserved for a shared launcher for Linux and macOS. There is no runnable launcher in this repository yet.

The intended command is `npm run launcher <hardware> <model>`. Recipes should eventually use it to prepare model assets, apply documented changes, and start an OpenAI compatible inference endpoint with OpenTelemetry hooks. Until the launcher exists, each recipe should provide its own tested setup and launch commands.

Hardware directories currently reserved under `hardware/` are `b60`, `bc-160`, `esp32`, `gb10-dgx-spark`, `m-series-macs`, `p100`, `radeon-7-vii`, and `v100`. Dual or multi-device configurations should be documented within the relevant recipe when implemented; they are not launcher options today.
