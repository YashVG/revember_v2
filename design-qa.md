# Product QA

## Current product shape

Revember has three primary places: **Today**, **Notes**, and **Questions**. Today offers one review action. Questions provides a review dock and a direct path to each question's topic context. A review returns to its origin instead of leaving the learner at an unrelated screen.

Question authoring has two explicit styles:

- **Fill in the blank**: write one statement containing the answer once; review replaces it with a blank.
- **Direct question**: write a complete prompt; the answer remains separate.

Both require a correct answer and support plausible alternatives and an optional explanation.

## Desktop audit — 9 August 2026

Manual inspection used the local macOS app at a 1254 × 768 desktop viewport.

- Today showed one clear review action, an accurate ready count, and a short preview of the queue.
- Question Library showed a compact **Review today** strip and a topic-first list with **Review N ready** and **View set** actions.
- Topic context showed compact question rows with **Practice**, **Edit**, and archive controls.
- Create question showed the two styles before any authoring field, with the correct fill-in-the-blank guidance visible by default.

No blocking visual or interaction issue was found in these paths. The audit did not alter learner data.

## Release gate

Run these checks before publishing a build or portfolio recording:

~~~bash
npm run verify
npm run test:e2e
npm run test:package
git diff --check
~~~

The automated gates verify behavior, build output, and the packaged-app boundary. The manual pass verifies hierarchy, copy, focus, and the return path through the current desktop interface.

## Selected Question Library redesign — visual QA

**Source visual truth**

- Selected ImageGen reference: `/Users/yash/.codex/generated_images/019fe6fe-4f89-79b1-a4e4-d885fd0280a3/exec-8ef770df-0364-47e2-bf1e-921cf85405df.png`
- Source dimensions: 1487 × 1058 px, normalized to 1440 × 1024 px for comparison.

**Rendered evidence**

- Electron implementation capture: `/tmp/revember-question-library-implementation.png`
- Comparison image: `/tmp/revember-question-library-comparison.png`
- Text-only follow-up capture: `/tmp/revember-question-library-text-only.png`
- Desktop viewport: 1440 × 1024 CSS px at device scale factor 1; implementation capture is 1440 × 1024 px.
- Compact desktop check: `/tmp/revember-question-library-1254.png` at 1254 × 768 CSS px.
- State: Question Library with two seeded topics and twenty new questions. The fixture intentionally differs from the reference’s topic names and due counts; the comparison evaluates layout, hierarchy, controls, and visual tokens.

**Full-view comparison**

- The rendered screen matches the selected direction’s slim review strip, dark desktop shell, cyan primary action, topic-list hierarchy, inline review states, and lightweight row dividers. A follow-up removed decorative Question Library icons at the user’s request.
- The existing Revember sidebar and real review-state labels are intentionally preserved rather than replacing them with mock-only chrome or data.

**Focused region comparison**

- The first `.question-topic-row` was checked against the reference topic row: topic title, question count, inline review state, review CTA, and `View set` affordance remain readable at both captured widths.

**Required fidelity surfaces**

- Fonts and typography: the existing system font and Revember weights preserve the reference’s clear title-to-metadata hierarchy; long topic names wrap without clipping.
- Spacing and layout rhythm: one review strip, a 35 px section pause, and 146 px topic rows remove the previous card-grid density while maintaining predictable alignment.
- Colors and visual tokens: dark graphite surfaces, hairline separators, cyan primary actions, and amber due indicators map directly to the selected direction.
- Image quality and assets: the Question Library is intentionally text-only after the follow-up refinement; no decorative topic or action icons remain in this screen.
- Copy and content: `Review today`, `Review N ready`, `View set`, and `Later` make the topic-level choice and future status concise.

**Findings and comparison history**

- [P2, fixed] At 1254 px, the previous `Scheduled` inline label was truncated. It is now the shorter, clearer `Later` label; the final compact capture shows the full label.
- [P3, fixed] Decorative topic and action icons competed with the compact library view. They were removed without changing any labels, behavior, or review actions.
- No actionable P0, P1, or P2 differences remain. The fixture’s two-topic/new-question data is an expected test-state difference, not visual drift.

**Verification**

- Questions renderer capture completed with no console errors.
- `npm test`: 153 passing tests.
- `npm run test:e2e`: passed review, topic-review, individual-practice, and return flows.
- `npm run test:package`: passed packaged-app smoke test.

final result: passed
