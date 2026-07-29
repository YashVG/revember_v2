# Today Surface Design QA

**Status: historical comparison record, superseded 26 July 2026.**

The original visual target and Electron captures were local working artifacts. They are not tracked in this repository, so this file is not a reproducible current visual baseline. The compared implementation also included calendar and exam-planner surfaces that have since been removed from the renderer.

## Evidence That Still Applies

- The app retains its dark macOS desktop shell, topic navigation, Today focus drawer, and lecture-note editor.
- The lecture editor autosaves exact draft text after a typing pause.
- **Finish lecture** is now the explicit boundary for optional local analysis.
- The interface uses the system font stack, Lucide icons, visible keyboard focus, and responsive layout rules.

## Superseded Findings

Do not use the old “passed” result as evidence for the current build. These prior claims no longer describe the product:

- mini-calendar and current-date event layouts;
- active exam-plan state;
- planner navigation;
- calendar-specific responsive behavior;
- visual fidelity to the untracked source image.

## Current QA Gate

Use automated checks for behavior:

```bash
npm run verify
npm run test:e2e
npm run test:e2e
node tests-electron/local-ai-e2e.mjs
npm run test:package
git diff --check
```

Before publishing a portfolio or release build, capture new screenshots from the packaged app and record:

- the exact commit and viewport;
- Today with draft and finished-note states;
- the local-study-response unavailable and ready states;
- Check-In across more than one question;
- Graph zoom and navigation;
- narrow-window behavior.

Until those artifacts are checked in or linked from a release, visual fidelity remains unverified.

---

# Topic overview design QA

## Evidence

- Source visual truth: `/Users/yash/.codex/generated_images/019f9ef3-f2b3-7e21-896e-f6ca59299938/exec-7ef1bf7d-495b-42a1-9940-17860738f017.png`
- Rendered implementation: `/tmp/revember-topic-overview-qa.png`
- Side-by-side comparison: `/tmp/revember-topic-overview-comparison.png`
- State: dark desktop topic overview for Bluetooth Low Energy, with the topic picker closed after selection.
- Implementation viewport: 1268 × 768 CSS px at device scale factor 1; captured from the built Electron app with an isolated temporary knowledge and progress store.
- Source pixels: 1487 × 1058. The source was downscaled to 1080 × 768 for the side-by-side comparison; the implementation remained 1268 × 768. The comparison intentionally excludes OS window chrome from the implementation capture, so the source chrome is not treated as a UI mismatch.

## Comparison history

### Pass 1 — blocked

The first side-by-side comparison found these actionable P2 differences:

- Concept rows used long explanatory paragraphs and read denser than the compact source list.
- Concept icons were too small and lacked the source's quiet circular treatment.
- The sidebar topic picker remained open after choosing a topic, adding a competing visual column that the selected direction does not show.

### Fixes applied

- Render each concept's concise first-principles statement instead of its longer explanation.
- Added restrained circular document icons and matched the row rhythm to the selected direction.
- Close the sidebar topic picker after a topic is selected.
- Promoted the secondary `Manage questions` action to the source's cyan emphasis.

### Pass 2 — passed

The revised comparison shows the intended hierarchy: summary, one review action, one question-management action, then a calm concept list. There are no actionable P0, P1, or P2 differences.

## Fidelity surfaces

- **Fonts and typography:** The implementation preserves a strong display heading, compact uppercase eyebrow, and clear row hierarchy. Actual topic copy is longer than the illustrative mock where necessary, but the first-principles text keeps row wrapping controlled.
- **Spacing and layout rhythm:** The header/action group, divider, and evenly spaced concept rows now follow the mock's calm vertical rhythm. The closed picker removes the largest competing region.
- **Colors and visual tokens:** The near-black workspace, cyan primary action, muted secondary copy, subtle dividers, and cyan secondary action align with the source direction.
- **Image quality and assets:** The source has no supplied product imagery or bespoke logo asset. The implementation uses the app's existing vector icon system; document icons are clear at the rendered size and have no raster artifacts.
- **Copy and content:** `Topic overview`, `Review N ready`, `Manage questions`, and `Concepts` describe the actual behavior. `Ready` is intentional because the count includes due, revised, and new questions.

## Follow-up polish

- [P3] If desired after more real-topic usage, cap very long concept titles to two lines so unusually verbose authoring cannot make a row visually dominant.

## Final result

passed

---

# Question library and authoring QA

## Evidence

- Source visual truth: user-provided `Create question` and `Edit question` desktop reference screenshots in this task.
- Rendered implementation: `/var/folders/tl/tt4y5n1s3t7_y_wxp1pcn2300000gn/T/com.openai.sky.CUAService/Electron Screenshot 2026-07-27 at 5.31.36 PM.jpeg`.
- State: a Bluetooth Low Energy topic with 10 authored questions; the create and edit dialogs were opened from the topic question library.
- Viewport: 1254 × 768 desktop window, dark mode, using the app's default Electron zoom factor and an isolated temporary profile.

## Comparison history

### Pass 1 — corrected

- [P2] The initial authoring dialog was narrower and more compressed than the supplied reference.
  - Fix: restored the target 620 px dialog width, header/body spacing, control heights, and textarea rhythm.

### Pass 2 — passed

- The question list now has a stable number, prompt, concept tag, and compact Review/Edit/Archive controls per item.
- The creation dialog matches the reference's centered, single-column hierarchy, visible primary save action, and expandable distractor area.
- The edit dialog retains all existing choices, explains why that structure is fixed, and disables Save until there is a substantive edit.

## Fidelity surfaces

- **Fonts and typography:** Existing app typography is preserved; compact labels and question prompts have a clear hierarchy.
- **Spacing and layout rhythm:** Question rows are scannable without an oversized action column. The dialog uses the reference's wider, breathable desktop scale.
- **Colors and visual tokens:** Existing near-black surfaces, cyan primary action, muted helpers, and ruby archive treatment remain consistent with Revember.
- **Image quality and assets:** The supplied references contain no imagery. The existing Lucide icon system provides consistent pencil, play, and archive symbols.
- **Copy and content:** `Question`, `New question`, and the helper text accurately describe the authoring and review behavior.

## Final result

passed

---

# Topic-to-notes action QA

## Evidence

- Source visual truth: `/Users/yash/.codex/generated_images/019f9ef3-f2b3-7e21-896e-f6ca59299938/exec-7ef1bf7d-495b-42a1-9940-17860738f017.png`, supplemented by the explicit request to expose each topic's associated notes.
- Topic action capture: `/tmp/revember-topic-notes-action-qa.png`
- Notes destination capture: `/tmp/revember-topic-notes-qa.png`
- Side-by-side comparison: `/tmp/revember-topic-notes-action-comparison.png`
- Viewport: 1268 × 768 CSS px at device scale factor 1. The source was normalized from 1487 × 1058 to 1080 × 768 for the comparison.
- State: a saved Bluetooth Low Energy note, topic overview, then the filtered Notes destination.

## Result

`View notes` is a compact secondary action between review and question management. The focused Electron check saved a temporary BLE note, opened the topic overview, activated `View notes`, and verified that Notes selected Bluetooth Low Energy and loaded the associated note. The additional action is an intentional, user-requested extension of the source direction; it introduces no actionable P0, P1, or P2 visual issue.

## Final result

passed
