# Revember v2 Spaced Repetition Product Research

**Status:** the research below guided the current product. It is retained as design rationale, not as a current implementation plan.

## Current Implementation

| Research direction | Current state |
| --- | --- |
| Due-first Today surface and short review queue | Implemented |
| Automatic Missed, Hard, Medium, and Easy difficulty | Implemented from correctness and active response time |
| Transparent local scheduler and exact next-review time | Implemented as `simple-v1` |
| Revision-bound immutable review events | Implemented |
| Per-choice rationales, gap tags, and misconception IDs | Implemented |
| Authored concept relationships | Persisted for authoring; not visualized in the topic UI |
| Codex handoff through local files and stdio MCP | Implemented |
| Keyboard answer shortcuts and session-repair animation | Deferred |
| Difficulty unlocking and adaptive success targeting | Deferred |
| FSRS scheduling adapter | Deferred; the event schema preserves a migration path |

The source of truth for present behavior is [Closed-Loop Learning Architecture](architecture/closed-loop-learning-system.md).

## Original Product Brief

Revember v2 was proposed as a local desktop app for turning first-principles learning sessions into durable technical memory. The intended experience was a focused fundamentals cockpit: a small daily queue, direct checks, immediate correction, and a visible map of weak concepts.

The app should optimize for solidifying knowledge, not vague familiarity. The primary loop is:

```text
Codex teaches -> Codex updates local knowledge JSON -> Revember schedules checks
-> user answers -> app records weakness -> next session targets the weak layer
```

## Research Takeaways

### 1. Spacing works because forgetting is useful when reviews are timed well

The spacing effect is one of the strongest findings in learning research. Cepeda et al. found distributed practice reliably beats massed practice across many memory tasks. The product implication is simple: Revember should not encourage binge-review as the main mode. It should make the next useful review obvious, small, and due at the right time.

Sources:
- Cepeda et al., 2006, distributed practice meta-analysis: https://www.evullab.org/pdf/CepedaPashlerVulWixtedRohrer-PB-2006.pdf
- Cepeda et al., 2008, optimal spacing depends on retention interval: https://pubmed.ncbi.nlm.nih.gov/19076480/

Design implication:
- Make the first screen "Due Now", not "All Topics".
- Hide or de-emphasize not-due cards.
- Show why something is due: "GATT vs GAP confusion returned after 3 days."

### 2. Retrieval beats rereading

Practice testing and retrieval practice produce stronger long-term learning than rereading. Karpicke and Roediger showed that repeated retrieval had a large effect on long-term retention even when learners thought repeated study felt better. Dunlosky et al. also rated practice testing and distributed practice as highly useful techniques.

Sources:
- Karpicke and Roediger, 2008, retrieval practice: https://profiles.wustl.edu/en/publications/the-critical-importance-of-retrieval-for-learning/
- Dunlosky et al., 2013, effective learning techniques review: https://pubmed.ncbi.nlm.nih.gov/26173288/
- Roediger and Butler, 2011, retrieval practice review: https://pubmed.ncbi.nlm.nih.gov/20951630/

Design implication:
- Concepts are reference material, but the default action should be "Check me".
- Concept pages should end with a direct question.
- The app should distinguish "viewed" from "retrieved correctly". Viewed content should not increase mastery much.

### 3. Feedback matters, especially for wrong answers

Retrieval without feedback can reinforce mistakes. For Revember, every answer should immediately explain:

- why the selected answer is wrong or right
- what similar term caused the confusion
- which gap tag this maps to
- what the correct mental model is

Design implication:
- After a wrong answer, do not just mark red.
- Show the gap: "Layer mapping gap: you selected GATT, but this question asks who manages radio packet exchange."
- Schedule a short follow-up rather than burying the item.

### 4. Multiple choice can work, but only if distractors are diagnostic

Bad multiple-choice questions train recognition and guessing. Revember's advantage is that Codex can write the distractors directly from the user's confusions. That makes choices diagnostic instead of random.

Useful question shapes:

- Concept boundary: "Which layer owns advertising roles?"
- Confusable terms: "GAP vs GATT vs Link Layer"
- Project mapping: "`bt_gatt_notify()` belongs to which step?"
- Causality: "Does notify create data or transport data?"
- Error spotting: "What is wrong with this statement?"

Design implication:
- Knowledge JSON should store `confusableTerms`, `gapTags`, and `answerRationale`.
- Every wrong answer should map to a likely misconception, not just "incorrect".

### 5. Difficulty should be desirable, not demoralizing

Desirable difficulty means learning tasks should be effortful enough to require retrieval but not so hard that the user is just guessing. Revember should avoid flooding the user with hard questions before the concept ladder is stable.

Sources:
- Bjork and Bjork, desirable difficulties overview: https://bjorklab.psych.ucla.edu/research/
- Kornell and Bjork, interleaving/category learning: https://pubmed.ncbi.nlm.nih.gov/18377168/

Design implication:
- Use a concept ladder: physical substrate -> signals -> bits -> bytes -> fields -> protocols -> layers -> implementation.
- Unlock harder questions only after intro questions are stable.
- Mix old and new concepts, but keep session success around a learnable range.

### 6. Adaptive scheduling should start simple

Revember does not need FSRS-level modeling on day one. FSRS and SuperMemo-style systems are useful references, but the app can begin with a transparent local scheduler:

- Missed: repeat soon, then tomorrow.
- Hard correct: repeat tomorrow or in 2 days.
- Good correct: grow interval.
- Easy correct: grow interval faster.

Sources:
- SuperMemo SM-2 algorithm: https://www.supermemo.com/en/blog/the-true-history-of-spaced-repetition
- FSRS overview and implementation: https://github.com/open-spaced-repetition/fsrs4anki
- Anki FSRS docs: https://docs.ankiweb.net/deck-options.html#fsrs

Design implication:
- Remove the second manual grading decision from the default flow.
- Incorrect answers are always `Missed`. Correct answers are tagged `Easy` below 5 seconds, `Medium` from 5–10 seconds, and `Hard` above 10 seconds.
- Pause timing while the app is unfocused and cap recorded time at 60 seconds so interruptions do not masquerade as difficult recall.
- Keep response time in the immutable event ledger so thresholds can become personalized after enough local evidence exists.
- Keep the algorithm understandable in the UI.
- Show "next review" directly on a concept.

This is an intentional Revember simplification, not a claim that Anki or FSRS schedule from response time. Anki says about 10 seconds is a useful point to stop struggling, but its timer is statistical and does not affect scheduling. FSRS uses review intervals and grades, not per-card response time. Memory research also cautions that accuracy and latency measure different aspects of memory, so correctness remains authoritative and latency only divides correct retrievals.

Sources:
- Anki answer guidance: https://docs.ankiweb.net/studying.html#answer-buttons
- Anki timer behavior: https://docs.ankiweb.net/deck-options.html#timers
- FSRS grading and timing FAQ: https://github.com/open-spaced-repetition/fsrs4anki/blob/main/docs/tutorial.md
- MacLeod and Nelson, 1984, response latency and accuracy: https://doi.org/10.1016/0001-6918(84)90032-5

Suggested v1 scheduler:

```text
New question:
  Missed -> due in 15 minutes
  Hard -> due tomorrow
  Good -> due in 2 days
  Easy -> due in 4 days

Review question:
  Missed -> interval = 1 day
  Hard -> interval = max(1, current interval * 1.2)
  Good -> interval = current interval * 2.2
  Easy -> interval = current interval * 3.0
```

## Engagement Strategy

The app should be compelling, but not manipulative. Avoid guilt streaks, fake urgency, loot-box randomness, infinite queues, or shame. The goal is "I want to do my 8-minute review because it feels clean and useful."

### Behavioral model

Fogg's behavior model says behavior happens when motivation, ability, and prompt converge. For Revember:

- Motivation: visible mastery and seeing gaps close.
- Ability: tiny daily queue, keyboard-first answering, no setup friction.
- Prompt: due items at the right time, not constant nagging.

Source:
- Fogg Behavior Model: https://behaviormodel.org/

### Motivation model

Self-determination theory says durable motivation is supported by autonomy, competence, and relatedness. Revember should lean hardest on autonomy and competence.

Source:
- Self-Determination Theory overview: https://selfdeterminationtheory.org/theory/

Design implication:
- Autonomy: user can choose topic focus, pause a topic, or do a short session.
- Competence: visible "this concept is stabilizing" feedback.
- Relatedness: optional connection to the Codex learning session that created the questions.

### Gamification that fits

Gamification can help when it supports meaningful progress, feedback, and competence. It becomes weak when points replace learning.

Sources:
- Deterding et al., gamification definition: https://pdfs.semanticscholar.org/1768/99ac1f3d4ab0b836b5f62eae511cb79a09b3.pdf
- Sailer et al., gamification and motivation: https://d-nb.info/1309619042/34

Good Revember mechanics:
- Mastery rings per concept.
- "Weak link repaired" moments after repeated correct retrieval.
- Small daily completion animation.
- Session recap that names the one gap improved.

Bad Revember mechanics:
- Coins, loot, shop systems.
- Leaderboards.
- Shame streaks.
- Infinite feeds of not-due questions.
- Random rewards that obscure learning.

## Visual Direction

### Product feel

Revember should feel like an intelligence dashboard for your own knowledge:

- dark, calm, high-contrast desktop app
- dense enough to feel serious
- enough motion/feedback to feel alive
- no decorative clutter
- no generic education app friendliness

Good style language:

```text
obsidian / graphite base
muted cyan for stable knowledge
dim amber for weak concepts
ruby only for actual misses
thin signal-line dividers
soft glass panels
compact macOS sidebar
monospaced metadata
large readable question prompts
```

### Why visual appeal matters

Attractive interfaces are often perceived as more usable, and clean visual hierarchy lowers friction. The design should use aesthetics to reduce resistance to starting a session, not to hide complexity.

Sources:
- Nielsen Norman Group on aesthetic-usability effect: https://www.nngroup.com/articles/aesthetic-usability-effect/
- Apple Human Interface Guidelines: https://developer.apple.com/design/human-interface-guidelines/

### Screen model

Revember should have three primary surfaces:

1. Today
   - due count
   - estimated session time
   - most fragile concepts
   - start review button

2. Topic Overview
   - short topic summary
   - concise concept list
   - one review action
   - one route to manage questions

3. Review Session
   - one question
   - 2-4 high-quality choices
   - immediate explanation
   - automatically inferred difficulty
   - next review date

### High-pull microinteractions

- Keyboard answers: `1`, `2`, `3`, `4`.
- Press `space` for next question.
- Smooth progress pulse when a concept strengthens.
- Amber warning when a miss maps to an old gap.
- After session: "You closed: Link Layer vs GATT."
- Show next review date as a satisfying lock-in moment.

## Knowledge JSON Outcome

The proposed card and progress split is now implemented with a richer contract:

- schema-v2 topics keep diagnostic cards in `questions`;
- cards have stable IDs and revisions, kinds, transfer levels, concepts, gap tags, source references, rationales, and misconception IDs;
- progress schema v2 keeps immutable `reviewEvents` separate from derived `reviewCardsByQuestionID` schedules;
- question revision changes make old evidence stale without deleting its history.

See [Closed-Loop Learning Architecture](architecture/closed-loop-learning-system.md) and the [MCP topic schema](../mcp-server/README.md#topic-schema) for the current fields.

## Historical Build Order

1. **Today queue — implemented.** It shows due items, time estimates, and the review action.
2. **Automatic difficulty — implemented.** A review saves the first answer, active response time, inferred difficulty, and next due date together without a second grading task.
3. **Local scheduling — implemented.** Progress migration, due sorting, and revision-bound evidence live in the shared domain.
4. **Diagnostic explanations — implemented.** Cards support choice rationales, misconceptions, gap tags, and concept links.
5. **Focused topic UI — implemented.** The topic surface intentionally contains only its summary, concept list, review action, and question management; visual release evidence remains separate.
6. **Codex handoff — implemented.** The stdio MCP server authors topics and reads the learner brief through local files.

## One-Sentence Product Strategy

Revember should not be Anki with a nicer coat of paint. It should be a local, beautiful, gap-aware retrieval workspace that turns Codex learning sessions into a daily fundamentals hardening loop.
