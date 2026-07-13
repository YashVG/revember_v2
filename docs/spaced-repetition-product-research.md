# Revember v2 Spaced Repetition Product Research

## Product Brief

Revember v2 should be a local desktop app for turning first-principles learning sessions into durable technical memory. The app should not feel like a generic flashcard tool. It should feel like a focused fundamentals cockpit: a small daily queue, direct checks, immediate correction, and a visible map of weak concepts.

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
- Cepeda et al., 2008, optimal spacing depends on retention interval: https://journals.sagepub.com/doi/10.1111/j.1467-9280.2008.02209.x

Design implication:
- Make the first screen "Due Now", not "All Topics".
- Hide or de-emphasize not-due cards.
- Show why something is due: "GATT vs GAP confusion returned after 3 days."

### 2. Retrieval beats rereading

Practice testing and retrieval practice produce stronger long-term learning than rereading. Karpicke and Roediger showed that repeated retrieval had a large effect on long-term retention even when learners thought repeated study felt better. Dunlosky et al. also rated practice testing and distributed practice as highly useful techniques.

Sources:
- Karpicke and Roediger, 2008, retrieval practice: https://www.science.org/doi/10.1126/science.1152408
- Dunlosky et al., 2013, effective learning techniques review: https://journals.sagepub.com/doi/10.1177/1529100612453266
- Roediger and Butler, 2011, retrieval practice review: https://www.sciencedirect.com/science/article/pii/S1364661310002081

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
- Add answer ratings after each question: `Missed`, `Hard`, `Good`, `Easy`.
- Keep the algorithm understandable in the UI.
- Show "next review" directly on a concept.

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
- Deterding et al., gamification definition: https://dl.acm.org/doi/10.1145/2181037.2181040
- Sailer et al., gamification and motivation: https://www.sciencedirect.com/science/article/pii/S074756321630855X

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

2. Topic Map
   - concept ladder
   - weak vs stable concepts
   - dependencies
   - source learning checkpoint

3. Check-In
   - one question
   - 2-4 high-quality choices
   - immediate explanation
   - answer rating
   - next review date

### High-pull microinteractions

- Keyboard answers: `1`, `2`, `3`, `4`.
- Press `space` for next question.
- Smooth progress pulse when a concept strengthens.
- Amber warning when a miss maps to an old gap.
- After session: "You closed: Link Layer vs GATT."
- Show next review date as a satisfying lock-in moment.

## Knowledge JSON Implications

The current `ble.json` should eventually evolve from simple concept/question storage into scheduling-ready cards.

Recommended additions:

```json
{
  "cards": [
    {
      "id": "ble-link-layer-role",
      "conceptIDs": ["link-layer"],
      "type": "multipleChoice",
      "prompt": "Which BLE layer owns radio packet exchange?",
      "choices": [
        {
          "id": "a",
          "text": "Link Layer",
          "isCorrect": true,
          "rationale": "Correct. This layer owns packet timing and connection mechanics."
        },
        {
          "id": "b",
          "text": "GATT",
          "isCorrect": false,
          "misconceptionTag": "application-vs-transport",
          "rationale": "GATT structures app-visible values after a connection exists."
        }
      ],
      "successCriteria": "Can distinguish transport mechanics from app data model."
    }
  ]
}
```

Progress should track scheduling separately:

```json
{
  "cardID": "ble-link-layer-role",
  "intervalDays": 4,
  "dueAt": "2026-06-07T09:00:00Z",
  "lastRating": "good",
  "lapseCount": 1,
  "weakConceptIDs": ["link-layer"]
}
```

## Recommended Build Order

1. Add Today queue
   - due cards
   - estimated time
   - start session

2. Add answer ratings
   - Missed, Hard, Good, Easy
   - save next due date

3. Add scheduling
   - local progress schema migration
   - due sorting
   - weak concept prioritization

4. Upgrade question explanations
   - per-choice rationale
   - misconception tags
   - concept gap panel

5. Redesign UI
   - dark cockpit visual system
   - topic map
   - polished check-in flow

6. Add Codex handoff format
   - after learning sessions, Codex can append concepts, gaps, and cards to topic JSON.

## One-Sentence Product Strategy

Revember should not be Anki with a nicer coat of paint. It should be a local, beautiful, gap-aware retrieval cockpit that turns Codex learning sessions into a daily fundamentals hardening loop.
