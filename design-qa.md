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
