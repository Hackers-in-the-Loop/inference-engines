# Taste

Taste lives in its own repository, [taste-benchmark](https://github.com/iammrduncan/taste-benchmark). That repository holds the prompts (simple, detailed, make-it-better with its starter), the isolated runner, and the gallery site. It also benchmarks hosted models that have no recipe here.

To run it against a recipe:

```sh
export TASTE_BENCHMARK_DIR=~/github/taste-benchmark
npm run launcher -- bench <recipe-id> --suite taste
```

The launcher starts the recipe, calls taste-benchmark's `scripts/run-benchmark.sh` against its OpenAI-compatible endpoint with the recipe's provenance, and stops the recipe afterwards. Each task runs in a fresh container that holds only that task. The demos land in `$TASTE_BENCHMARK_DIR/demos/<model>/<engine>/<task>/`, ready for a PR there; this repo keeps the run-config.

Gallery names come from the recipe's `benchmarks.taste: {model, engine}`, or else from its id.

Taste results are never scored or merged into quality numbers.
