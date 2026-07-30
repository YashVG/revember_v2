# Today Surface Design QA

**Status: historical comparison record, superseded 26 July 2026.**

The original visual target and Electron captures were local working artifacts. They are not tracked in this repository, so this file is not a reproducible current visual baseline. The compared implementation also included calendar and exam-planner surfaces that have since been removed from the renderer.

The Notes workspace, lecture-note capture, AI topic-note, and visible concept-panel surfaces described in later sections have also been removed from the current renderer.

## Evidence That Still Applies

- The app retains its dark macOS desktop shell, topic navigation, and Today focus drawer.
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
npm run test:package
git diff --check
```

Before publishing a portfolio or release build, capture new screenshots from the packaged app and record:

- the exact commit and viewport;
- Today with due and empty-queue states;
- question authoring and review;
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

# Home review-day design QA — 29 July 2026

## Evidence

- Source visual truth: `/Users/yash/.codex/generated_images/019fa8b2-f696-7fe0-a29c-ea8fec2896ca/exec-3386f61b-c00d-4750-af49-bb5679c5eb35.png`.
- Rendered implementation: `/tmp/revember-home-review-implementation-final.png`.
- Side-by-side comparison: `/tmp/revember-home-review-comparison-final.png`.
- State: the local Electron preview at `localhost:5173`, Home selected, with 12 due questions across Bluetooth Low Energy, Operating Systems and Computer Architecture, and Test.
- Viewport and density normalization: the source is 1602 × 981 pixels; it was normalized to 1253 × 768. The Electron desktop capture is 1253 × 768; the desktop capture service does not expose a separate CSS scale factor, so both visible product regions were compared at their captured 1× raster dimensions, including the same window chrome.

## Comparison history

### Pass 1 — blocked

- [P2] At the live desktop width, `Your review is ready` wrapped to two lines while the selected source direction keeps it as one calm display line. The Home content also sat too far from the sidebar and lacked the session-topic icon treatment.

### Fixes applied

- Reduced the review-day page’s horizontal inset and tuned the display scale/letter spacing so the hero heading remains on one line at the captured desktop size.
- Kept the live queue data, added the existing Lucide topic icons, and made the continuation destination open the selected topic’s Notes reader directly.

### Pass 2 — passed

The final side-by-side comparison preserves the source’s single, quiet review action, two-column hierarchy, vertical divider, thin after-review rule, and restrained cyan emphasis. The implementation shows a third session row only because the live queue contains a third topic; that is intentional live content rather than a hierarchy mismatch.

## Focused interaction evidence

- `Start 9-minute review` opened the complete queue as `1 of 12`, matching the duration/copy on Home rather than the former four-question batch.
- `Open Bluetooth Low Energy notes` opened the Bluetooth Low Energy note reader directly, with the existing selected note and section navigation intact.

## Fidelity surfaces

- **Fonts and typography:** System typography, compact uppercase eyebrow, one-line display heading, and muted body copy match the visual hierarchy. The long operating-systems topic truncates cleanly in its live-data row rather than forcing a wider or taller session panel.
- **Spacing and layout rhythm:** The hero, session preview, and after-review strip align on a calm vertical rhythm with no competing card or permanent note editor.
- **Colors and visual tokens:** Existing near-black surfaces, hairline dividers, muted secondary text, and cyan action/color tokens match the source direction.
- **Image quality and assets:** The target contains no bespoke raster assets. Existing Lucide icons are used for the review and topic rows; there are no substituted image or CSS-art assets.
- **Copy and content:** Queue count, estimated minutes, session topic counts, and the notes destination are derived from current app data. The exact words adapt to the current topics while retaining the selected flow’s intent.

## Final result

passed

---

# Home study-focus design QA — 29 July 2026

## Evidence

- Source visual truth: `/Users/yash/.codex/generated_images/019fa8b2-f696-7fe0-a29c-ea8fec2896ca/exec-5a64444e-4249-4bac-816d-ea1a92ced355.png`.
- Rendered implementation: [`design-qa-assets/home-study-focus-implementation-2026-07-29.jpg`](design-qa-assets/home-study-focus-implementation-2026-07-29.jpg).
- Full-view comparison, source left / implementation right: [`design-qa-assets/home-study-focus-comparison-2026-07-29.png`](design-qa-assets/home-study-focus-comparison-2026-07-29.png).
- State: Home with three due questions, a current attention signal for Characteristic, and no chat or prompt control.
- Viewport: 1254 × 768 pixels. The generated source was 1603 × 981 pixels and was proportionally normalized to 1254 × 768 before the comparison. The implementation capture was already 1254 × 768 at the Electron desktop scale; both comparisons include matching application chrome.
- Focused-region comparison: not needed separately; the session card, attention strip, and learning actions remain fully legible in the full comparison.

## Comparison history

### Pass 1 — passed

No actionable P0, P1, or P2 differences remain.

- The implementation preserves the source’s single dominant review action, session preview, quiet attention strip, and lightweight continuation actions.
- Live queue data changes the displayed count and question text from the illustrative mock. That is intentional: the card is derived from the existing current review queue rather than static content.
- The source’s `See progress` link is intentionally omitted because the app has no standalone progress destination. The remaining footer accurately states the seven-day evidence window without creating a dead-end action.

## Focused interaction evidence

- `Start review` opened the first due check as `1 of 3` in the existing review flow.
- `Write a note` opened the Notes topic chooser.
- `Create a question` opened the real topic picker immediately, ready to enter the existing question-authoring flow.
- `Practice this topic` remains grounded in current, due questions for the attention topic; when none are ready it opens that topic’s notes instead.

## Fidelity surfaces

- **Fonts and typography:** Existing system font stack, compact cyan eyebrow, display heading, and readable session rows match the source hierarchy. Live long question text truncates or wraps within the row rather than widening the panel.
- **Spacing and layout rhythm:** The implementation uses one broad session card followed by a low-emphasis attention strip and two text actions. This preserves the intended primary-to-secondary rhythm and uses the full desktop width without a chat field.
- **Colors and visual tokens:** Existing near-black surfaces, graphite borders, off-white type, cyan actions, and restrained red attention signal map directly to Revember’s current tokens.
- **Image quality and assets:** The target contains no bespoke raster imagery. The implementation uses the existing Lucide icon library consistently; no replacement artwork or placeholder asset was introduced.
- **Copy and content:** All queue counts, topics, question previews, and attention signals are derived from current local study data. The screen contains no natural-language prompt or chat response.

## Follow-up polish

- [P3] If a dedicated progress page is added later, the footer can regain a `See progress` action without changing this layout.

## Final result

passed

---

# Notes reader design QA — 29 July 2026

## Evidence

- Source visual truth: `/Users/yash/.codex/generated_images/019fa8b2-f696-7fe0-a29c-ea8fec2896ca/exec-ef41ef7b-4fde-4a9a-8515-3b1f62062d45.png`
- Rendered implementation: `/var/folders/tl/tt4y5n1s3t7_y_wxp1pcn2300000gn/T/com.openai.sky.CUAService/Electron Screenshot 2026-07-29 at 3.45.51 PM.jpeg`
- Side-by-side comparison: `/tmp/revember-notes-reader-comparison.png`
- State: Bluetooth Low Energy note reader, dark desktop layout, one source section visible, `Read all` off, section menu closed.
- Source dimensions: 1672 × 941 pixels. Implementation capture: 461 × 283 pixels from the desktop-app capture service. The source was downscaled to 503 × 283 for the comparison; this is a structural comparison, not a 1:1 pixel-density claim.

## Focused interaction evidence

- Opened `All sections`; the menu exposed all six sections with the current section marked.
- Selected section 4; the compact progress row and source text changed together.
- Activated `Next`; the reader advanced to `5 / 6`, updated the inline section label, and swapped the visible source text.

## Findings

No actionable P0, P1, or P2 differences remain for the selected direction.

- The duplicate display-sized section heading and the ambiguous source status/retry strip were removed.
- The current section title is now the semantic heading beside `1 / 6`; the source begins directly with its original text.
- The section menu, `Read all`, and `Make question` actions occupy one compact row without competing with the prose.
- The footer keeps the review-like progression controls visible while the original text retains a constrained reading width.

## Fidelity surfaces

- **Fonts and typography:** The section label is now compact and subordinate to the note title; original source text has a larger, more open reading rhythm. Generic fallback labels such as `Section 1` are content-derived when an organizer title is unavailable, not a layout regression.
- **Spacing and layout rhythm:** The outer source card and duplicate header were removed. The toolbar, prose column, and footer now form a single reading flow with no unused panel between controls and text.
- **Colors and visual tokens:** The implementation keeps the existing near-black surfaces, hairline dividers, muted utility actions, and cyan current-section/primary-action treatment from the chosen direction.
- **Image quality and assets:** The target contains no bespoke imagery. Existing Lucide icons remain consistent with the rest of the app; no new image or placeholder asset was introduced.
- **Copy and content:** `Read all`, `All sections`, `Make question`, and `1 of 6` describe the actual reader behavior. The original source text remains verbatim.

## Follow-up polish

- [P3] When local organization supplies descriptive section titles, they will replace generic deterministic fallback names such as `Section 1`; no visual change is needed for the reader layout.

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

# Notes header removal follow-up — 29 July 2026

## Evidence

- Source visual truth: the user-provided desktop capture requesting removal of the page-level `Notes` title and helper text.
- Rendered implementation: `/var/folders/tl/tt4y5n1s3t7_y_wxp1pcn2300000gn/T/com.openai.sky.CUAService/Electron Screenshot 2026-07-29 at 3.57.23 PM.jpeg`.
- Viewport and state: 1254 × 768 desktop window, Bluetooth Low Energy → BLE test, with a selected topic and six-section source reader.
- Focused comparison: the notes-content region was inspected against the supplied capture. A direct pixel match is intentionally not expected because removing the old header is the requested visual delta.

## Result

The page-level heading and helper copy are gone, so the topic index and note reader begin immediately beneath the app chrome. `New note` remains available in the topic chooser and directly beneath the selected topic heading. Typography, spacing, existing dark tokens, icons, and copy remain consistent with the selected reader direction; no image asset is involved. No P0, P1, or P2 visual issue was introduced by the denser layout.

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

---
