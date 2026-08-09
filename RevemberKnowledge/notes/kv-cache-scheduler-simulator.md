# KV-Cache Scheduler Simulator

## What this project is

This is a C++17 simulator for the scheduling layer of an LLM inference server. It does not run an LLM. It models many requests competing for limited KV-cache capacity.

The core flow is:

```
CSV workload
  -> waiting queue
  -> admission policy
  -> active batch
  -> prefill/decode steps
  -> completed requests
  -> latency and utilization metrics
```

## Why KV cache matters

An autoregressive LLM stores attention state for tokens it has already processed. That state is the KV cache. Longer prompts and longer outputs require more memory.

The simulator currently uses a conservative token-unit model:

```
reservation = prompt_tokens + max_output_tokens
```

Real systems use bytes, model dimensions, data types, block allocation, prefix sharing, and dynamic growth. Those are future improvements.

## Current policies

- Strict FCFS: only the oldest fitting request can enter. This demonstrates head-of-line blocking.
- Smallest-reservation-first: chooses the smallest fitting reservation. The CLI currently calls this `shortest`, but that name should be corrected.
- KV-aware: chooses a large fitting reservation to pack capacity, then prioritizes requests that have waited past the starvation threshold.

## Current simulation loop

At each tick, the simulator:

1. Adds arrived requests to the queue.
2. Admits requests while batch and KV capacity allow.
3. Processes prompt chunks or one output token for active requests.
4. Marks completed requests and releases their reservation.
5. Advances the simulated clock.

The main limitation is that every active request receives progress each tick. There is no shared global token budget yet.

## Current use

```bash
cd /Users/yash/Desktop/kv-cache-scheduler-sim
make test
make compare
./build/kv-sim workloads/mixed.csv --policy kv-aware --details
```

## Learning roadmap

1. Implement a first-fit policy and prove it avoids head-of-line blocking.
2. Build a seeded workload generator with multiple arrival and length distributions.
3. Add TPOT, p99 latency, fairness, SLO success, and CSV result export.
4. Add a shared per-step token budget with decode priority and chunked prefill.
5. Add dynamic paged KV allocation, fragmentation, prefix reuse, and preemption.

The project becomes résumé-ready when the experiments are reproducible, the metrics are complete, and the conclusions explain which policy wins under which workload—not when every production feature has been implemented.
