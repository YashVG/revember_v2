# Local Intelligence Research Record

**Status: historical research record from 25 July 2026.** The extracted study-response experiment described here has been removed. This record remains only as design history; note section organization remains in the Notes reader, while topic-note generation has been removed from the current product surface. The other local AI surface is review-gated distractor assistance.

## Superseded study-response experiment

The experiment autosaved a learner's note as a draft without analysis. **Finish lecture** marked the selected revision ready and started a best-effort local response in the background. The atomic capture remained the source of truth; model output was a revision-keyed, separate artifact. The app worked normally when the model was absent. No account login, cloud inference, model download, or automatic Ollama startup was part of that feature.

It used Ollama with `llama3`, structured JSON, `think: false`, one request at a time, and `keep_alive: 0`. The first copy-an-exact-quote prompt failed on a real note: `llama3` returned an empty evidence field, an inexact quote, and eleven points despite the smaller persistence contract. The experiment therefore gave the model enum-constrained source-segment IDs and reconstructed content from selected exact excerpts. It was removed because the resulting study-response surface was not useful enough to keep.

## Local baseline

The tests below used a MacBook Pro with an M3 Pro and 18 GB unified memory. They used the same structured-response prompt, `num_ctx: 4096`, and `temperature: 0`; they are an orientation check, not a quality benchmark.

| Model | Download size | Cold load | Output rate | Total response |
| --- | ---: | ---: | ---: | ---: |
| `qwen3:4b` | 2.5 GB | 2.221 s | 30.99 tokens/s | 7.595 s (160 tokens; output limit reached) |
| `llama3:latest` | 4.7 GB | 3.522 s | 24.57 tokens/s | 8.056 s (103 tokens) |

`qwen3:4b` was smaller and faster in this benchmark, but the current implementation uses `llama3` by product decision. Treat the table as a baseline, not a quality ranking; retest with real notes before making a performance claim. Ollama documents [schema-constrained responses](https://docs.ollama.com/capabilities/structured-outputs) and unloading with [`keep_alive: 0`](https://docs.ollama.com/faq).

## Learning direction: generative compression

The pasted “Generative Compression” proposal is a useful **V2 product spec**, but it has no citations and assumes SwiftUI while Revember uses Electron, React, and TypeScript. The shared research thread supplies its evidence. In one controlled study, deeper note processing (summary or paraphrase) outperformed verbatim and shallow conditions. [Bretzing and Kulhavy (1979)](https://eric.ed.gov/?id=EJ203998). A 2024 meta-analysis of 24 studies found higher achievement for handwritten notes plus review (`g = 0.248`), although typed notes had greater volume. [Flanigan et al.](https://link.springer.com/article/10.1007/s10648-024-09914-w).

These results do **not** establish that writing fewer words improves learning. Mueller and Oppenheimer found that greater verbatim overlap was associated with weaker conceptual performance in their experiments; the article has a later corrigendum. [Study](https://pubmed.ncbi.nlm.nih.gov/24760141/), [article with corrigendum](https://courses.cit.cornell.edu/econ6100/ThePenIsMightierThanTheKeyboard.pdf). A 57-study meta-analysis also found the general encoding benefit of note-taking positive but modest and dependent on material and assessment. [Kobayashi (2005)](https://eric.ed.gov/?id=EJ697806). Retrieval practice and generative learning provide independent support for the recall-and-revision part of the design. [Karpicke and Blunt (2011)](https://pubmed.ncbi.nlm.nih.gov/21252317/); [Fiorella and Mayer (2023)](https://link.springer.com/article/10.1007/s10648-023-09769-7).

If implemented, compression needs a distinct author-provided source and explicit `requiredConceptIDs`; hiding a learner's own note would not create a source-recall cycle. Preserve attempts, source reveals, and self-assessment separately. Use a soft target, required-concept coverage, and transparent phrase-overlap signals to guide revision. Never score fewer words as inherently better. A local model can offer a hint only after the learner's first attempt; it must not write the attempt for them.

## Deferred work

- **spaCy:** useful later for deterministic sentence and noun-phrase metadata, but not a V1 response generator. Its relevant capabilities are documented in its [linguistic features guide](https://spacy.io/usage/linguistic-features).
- **Prodigy:** a self-hosted annotation and evaluation workbench, useful after Revember has real Accept/Edit/Reject feedback to label. It is not an inference backend; its current personal licence is listed at US$390, so do not adopt it before that feedback loop exists. [Product overview](https://prodi.gy/), [pricing](https://prodi.gy/buy).
- **Fine-tuning / QLoRA:** defer until there is a representative, consented evaluation set and a measured failure mode that prompting and validation cannot address.

## Current boundary

The current product keeps learner note capture, source section organization, authored questions, review scheduling, and review-gated distractor suggestions. Add compression only as a separate source-and-recall feature after real-material evaluation validates that loop.
