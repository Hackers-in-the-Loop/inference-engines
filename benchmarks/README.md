# Benchmarks

Each recipe has an accompanying benchmark, ran from our benchmark suite.


Typically like:

```
- /hardware
  - /<hardware-name>
    - /<model-name>
      - /benchmarks
        - ...
```

To run do:

```
npm run launcher <hardware> <model>
npm run benchmarks <hardware> <model>
```

Benchmarks are not ran always across all HARDWARE x MODEL. If one is missing and you have the hardware, please feel free to launch a benchmark and PR it in!
