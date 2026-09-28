# Taste (placeholder)

This suite will look at a model's "taste": things like SVG or scene generation, style imitation and design critique, judged by people or a panel. The design is deferred.

Prompts so far, in `prompts/`:

| Prompt | Input |
| --- | --- |
| `taste-simple.md` | None; a one-paragraph brief. |
| `taste-detailed.md` | None; the full brief. |
| `taste-make_it_better.md` | A starter `index.html` to elevate: [`taste-make_it_better-starter/index.html`](prompts/taste-make_it_better-starter/index.html). |

The starter is a deliberately low-fidelity version of the `taste-simple` scene. It uses flat boxes and flat light, but it works: Three.js 0.180.0 `WebGPURenderer` (WebGL2 fallback), WASD camera-relative movement with collisions, a bridge over the stream, a real door, a furnished interior, a roof and front-wall cutaway on entry, and R to reset. It was checked in headless Chromium through the WebGL2 fallback.

When it's designed, the suite needs:

- a fixed prompt set with its revision recorded;
- a judging method (human panel, pairwise comparisons, or model judges with their pins);
- a result format that attaches to a recipe run like the other suites.

Taste results are reported on their own and are never combined into quality scores.
