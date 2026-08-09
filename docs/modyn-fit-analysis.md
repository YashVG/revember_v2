# Modyn Fit Analysis for Revember

**Status:** Research record, 5 August 2026. Post-review schedule-decision lineage is now implemented; no trainer, daily coordinator, or learned model exists.

## Decision summary

Revember should not integrate the Modyn runtime. Modyn's abstraction applies to growing datasets generally, but its multi-component infrastructure is designed especially for costly recurring neural training and large labeled datasets. Revember currently has one local learner, a small event ledger, and sparse delayed outcomes. Its limiting problem is evidence quality, not training throughput.

Revember should reuse five Modyn ideas:

1. Separate the decision to train from the decision about which data to use.
2. Tie every model to selected training data and temporal bounds, then extend that lineage with Revember's event cutoff and feature contract.
3. Replay historical events through the same policy intended for production.
4. Evaluate the model that was actually available at each point in time.
5. Compare predictive quality against fair system-cost measures; Revember must additionally measure user workload.

The first practical alternative is a domain-specific memory scheduler such as FSRS with default parameters. Personalized parameter fitting can begin after Revember has enough review history. A custom predictor should remain a shadow experiment until it consistently improves future predictions.

## What Modyn solves

Modyn is a data-centric machine-learning pipeline orchestrator for datasets that grow over time. Its central concern is the cost of repeated training. That cost has two independent controls:

- **Training frequency:** how often the pipeline trains.
- **Training volume:** how many observed samples each run uses.

Modyn makes each control an explicit policy:

- A **triggering policy** decides whether an incoming sample should cause a training run.
- A **selection policy** assigns weights to observed samples and thereby defines the next training set.

The paper uses *retraining* to include fine-tuning and training from scratch. Modyn is therefore an execution and evaluation framework, not a new learning algorithm.

## The paper's model

The input is a time-ordered stream of labeled samples. Each sample has an identifier, timestamp, label, metadata, and payload.

At trigger `r`, the triggering policy has observed every sample up to that point. The selection policy can assign a positive weight to any observed sample. It may choose:

- all observed history;
- only data since the previous trigger;
- data from the last `n` triggers; or
- an arbitrary weighted subset.

This distinction corrects a common design mistake: a process may wake every 24 hours without training every 24 hours. The wake schedule runs the eligibility check. The trigger policy may return “no training.”

## Platform boundary

Modyn sits between preprocessing and model serving:

1. An external system produces a labeled stream after expensive offline preprocessing. Online transformations such as augmentation or tokenization may still run inside Modyn.
2. Storage assigns sample IDs and stores sample payloads and metadata.
3. The supervisor applies the trigger policy.
4. The selector materializes sample IDs and weights for the run.
5. The trainer loads the selected samples and optionally the previous model.
6. Model storage persists the trained model.
7. The evaluator scores models on configured temporal intervals.
8. An external serving system may deploy a model.

The platform uses PostgreSQL, C++, Python, gRPC, Docker Compose, PyTorch, and sample-level data retrieval. These choices address large datasets and data-loader throughput. They do not solve Revember's current bottleneck.

Modyn also has two useful execution modes:

- **Production mode** consumes genuinely new samples.
- **Experiment mode** replays stored samples as if they were arriving live.

The same trigger and selection semantics run in both modes. The paper calls this “what you evaluate is what you deploy,” although actual serving and deployment remain external to Modyn.

## Trigger policies

| Policy | Modyn behavior | Revember fit |
| --- | --- | --- |
| Amount | Train after `n` new samples | Best initial fit: require enough new eligible review outcomes |
| Time | Train after a fixed duration | Useful as a wake/check cadence, not as an unconditional training rule |
| Performance | Train after quality falls below a threshold | Too noisy initially; labels are sparse and delayed |
| Drift | Train when input distributions differ | Diagnostic only; a new course can create note drift without degrading recall prediction |

For unstructured data, Modyn generates embeddings, compares reference and current windows, and primarily uses maximum mean discrepancy. Its fixed-threshold and AutoDrift variants turn the score into a binary trigger. The authors explicitly leave the embedding model, interval, metric, window, and threshold as open research choices.

This matters for Revember. A learner starting a physics course after studying operating systems creates obvious content drift. That does not prove that the memory scheduler needs retraining.

## Selection policies

Modyn separates selection into a data window, presampling, and downsampling.

- **Presampling** uses sample metadata before a model forward pass. Examples include uniform, class-balanced, and trigger-balanced sampling.
- **Downsampling** uses loss, uncertainty, or gradients from a forward pass to decide which examples receive backward passes.
- Either strategy can work on all history, new data, or a bounded history window.

These mechanisms primarily reduce the cost of deep learning on large datasets. Revember should initially train on every eligible review event. Throwing away sparse personal outcomes is more likely to remove signal than save meaningful compute.

Class balancing also needs care. Artificially balancing correct and incorrect outcomes can damage probability calibration unless the training loss and evaluation restore the real outcome distribution.

## Composite-model evaluation

This is Modyn's most transferable contribution for Revember.

A continuous pipeline creates a sequence of models, not one final model. Trigger policies create those models at different times. Comparing only the final models ignores the quality users experienced during the pipeline's lifetime.

Modyn therefore:

1. Defines temporal evaluation windows independently of trigger times.
2. Evaluates every model on every compatible window.
3. Maps one model to each window to form a **composite model**.
4. Reduces that mapping to a quality-over-time series.
5. Optionally averages the series into a pipeline score.

The paper defines two mappings:

- **Currently active:** use the newest model that finished before the evaluation anchor. This represents production behavior.
- **Currently trained:** use the next model in the sequence. This is a retrospective next-model view that may benefit from training data similar to the evaluation interval; it is not a production metric.

Revember should use the currently active interpretation, with availability defined by the question being asked:

- A production audit maps each interval to the model Revember had actually adopted before that interval.
- An offline replay of an unshipped pipeline maps each interval to the model that its simulated trigger, training duration, validation, and activation rules would have made available.

In neither case may a future-trained model score an earlier interval. Training completion alone is insufficient for a production audit because Modyn does not own deployment; a simulated pipeline must make its hypothetical activation rule explicit.

The paper also compares pipeline quality with cost as a Pareto feasible set. Each cost proxy has conditions: trigger count is comparable only under the same new-data selection regime; sample count ignores trigger and selection overhead; wall-clock comparisons require isolated machines. Revember should additionally track review workload, local runtime, power use, failed jobs, and unstable scheduling.

## What the experiments establish

The results support policy experimentation, not one universal policy. The selection experiments use the currently trained composite model. The trigger experiments use currently active models because the currently trained mapping would unfairly favor infrequent triggers. Their aggregate percentages therefore should not be compared across those two experiment groups.

| Experiment | Result | Interpretation |
| --- | --- | --- |
| Yearbook selection | Full data reached 92.3% mean accuracy. At a 50% budget, entropy reached 91.4%; least-confidence and margin reached 91.2%. | Some uncertainty sampling nearly matched full training on this covariate-shift dataset. |
| CGLM selection | Full data reached 51.5% top-5 accuracy. The best 50% policy reached 44%. Policy rankings changed at 25% and 12.5% budgets. | Selection quality depends on the dataset and budget. Full data remained materially better. |
| Yearbook triggers | Annual training reached 93.1% with 75 counted triggers. Every three years reached 92.8% with 26. AutoDrift reached 92.7% with 14. | A simple cadence was already competitive. Fixed MMD variants required tuning; AutoDrift removed the absolute score threshold but retained other configuration choices. |
| arXiv triggers | A 75% performance threshold caused 154 triggers; 70% caused 12. AutoDrift reached 73.8% top-2 accuracy with 30 triggers. | Trigger behavior can be highly threshold-sensitive. |
| Throughput | Modyn approached sequential local throughput on CGLM and retained 71-98% on Criteo, depending on worker count. | The systems design supports large sample-level access; this is not Revember's present problem. |

The annual Yearbook policy fires 84 times overall; 75 is the count after every compared pipeline has fired once. The trigger analysis excludes earlier windows to make averages comparable. In that section, “full data” means no downsampling within each new inter-trigger window while fine-tuning the prior model, not training from scratch on all accumulated history.

The selection datasets contain tens or hundreds of thousands of samples. The arXiv experiment contains about two million. These results do not establish that selection or drift detection helps one learner producing tens of events per day.

## Scope and limitations

The paper states or implies the following boundaries:

- Input is labeled. Unsupervised and generative-LLM training are future work.
- Expensive preprocessing happens before Modyn.
- The paper evaluates a small set of datasets and policy combinations.
- Drift configuration for text and images remains open.
- The platform handles growing data; deletion and machine unlearning are future work.
- Provenance analysis and optimal storage of multiple model versions remain research opportunities.
- Serving and deployment are external.

Modyn does **not** define a champion/challenger promotion gate, rollback policy, or user-safety policy. It also does not solve causal evaluation for a scheduler whose own choices determine which questions are observed. Revember must add those boundaries.

## Fit to Revember

Revember already has several prerequisites:

- The review-commit API only appends to the logical ledger, and [`ReviewEvent`](../shared/types.ts) stores question revision, correctness, rating, active response time, concept metadata, and review time. The physical JSON file is atomically rewritten and is not tamper-evident append-only storage.
- New review events also store the resulting `simple-v1` schedule decision, its prior-decision chain, and a result snapshot. The current card projection links back to that decision. Existing events remain unbackfilled.
- [`applyReviewEvent`](../shared/domain.ts) deterministically replays each question revision's history.
- [`ReviewCardState`](../shared/types.ts) already stores a `schedulerVersion`.
- [`CaptureStore`](../electron/capture-store.ts) and note segmentation separate authored text from derived model output.
- Atomic persistence protects progress from partial writes.

Important gaps remain:

- Interactive reviews now timestamp the first selected answer, and new events preserve the schedule output created afterward. They still lack the pre-answer treatment, presentation time, queue/slate, active predictor, feature version, and recall prediction.
- Note revision numbers do not preserve immutable historical text.
- UI-authored questions currently discard note-section provenance.
- The app records answered questions, but not offered, skipped, or abandoned questions.
- There is no training-run manifest, model registry, active-model pointer, shadow evaluation, promotion gate, or rollback.
- There is no reliable 24-hour executor. An external writer must not modify `progress.json`, because the running app owns in-memory progress.
- Current note input is text typed or pasted into the app. Document/image ingestion and OCR are planned ideas, not current behavior.

## Concept bridge to Revember

The useful translation is narrower than “put Modyn around the app”:

| Modyn concept | Revember translation | Important boundary |
| --- | --- | --- |
| Labeled stream sample | A delayed question exposure followed by a correctness outcome | A note or embedding is input content, not a recall label |
| Trigger policy | The decision that enough new eligible evidence exists to justify another candidate | A 24-hour wake-up may legitimately return no training |
| Selection policy | Versioned eligibility rules and temporal history window | Use all eligible personal history first; downsampling saves no meaningful cost |
| Trainer | Default/optimized FSRS or a small calibrated predictor | Do not fine-tune the local LLM from raw notes or correctness events |
| Experiment replay | Rolling-origin reconstruction using only evidence available at each time | Legacy events lack decision lineage; current instrumented events still lack exact presentation and pre-answer treatment |
| Composite model | Map each evaluation block to the predictor actually available in production or available under the simulated pipeline | A future-trained candidate cannot score its own past |
| Model storage | Versioned local candidate, manifest, and hashes | Training completion is not activation |
| External deployment | Electron validates and adopts a compatible candidate at a safe boundary | Modyn itself supplies no Revember promotion, rollback, or causal policy trial |

This bridge creates three separate loops. Note revisions update authored content and, eventually, retrieval. Content acceptance/edit/rejection can improve question-generation prompts or models. Review correctness updates a recall predictor. Combining them into one nightly training dataset would give the model incompatible targets.

The simplest useful sequence is therefore a base-rate and delay-only prediction benchmark, default FSRS, occasional FSRS optimization after enough history, and only then a custom model. A user-selected retention/workload control may deliver more product value than personalization. Any candidate can remain a shadow predictor indefinitely; changing due dates requires a separate online policy evaluation because the outcome at an unchosen delay is unobserved.

## Necessity verdict

The full Modyn platform is unnecessary now. Its value is the shape of the experiment:

- explicit trigger policy;
- explicit eligibility/selection policy;
- immutable run and model lineage;
- chronological replay;
- active-model evaluation;
- quality-versus-cost comparison.

The first scheduler comparison should be:

1. current `simple-v1` rules;
2. FSRS with default parameters;
3. FSRS with occasional local parameter optimization, after enough history;
4. only then, a custom half-life or calibrated logistic predictor in shadow mode.

Online learning, contextual bandits, embedding-drift triggers, and sample downselection should remain deferred until simpler approaches show a measured limitation.

## Primary sources

- Böther et al., [Modyn: Data-Centric Machine Learning Pipeline Orchestration](https://doi.org/10.1145/3709705), SIGMOD 2025; [author PDF](https://anakli.inf.ethz.ch/papers/modyn_sigmod25.pdf).
- ETH Systems Group, [Modyn project overview](https://systems.ethz.ch/research/blog/modyn.html).
- ETH EASL, [Modyn source and documentation](https://github.com/eth-easl/modyn).
- Open Spaced Repetition, [SRS benchmark](https://github.com/open-spaced-repetition/srs-benchmark) and [TypeScript FSRS toolkit](https://github.com/open-spaced-repetition/ts-fsrs).
- Anki, [FSRS documentation](https://docs.ankiweb.net/deck-options.html#fsrs).
- Settles and Meeder, [A Trainable Spaced Repetition Model for Language Learning](https://research.duolingo.com/papers/settles.acl16.pdf).
- River, [online machine-learning project](https://github.com/online-ml/river).
