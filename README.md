# Revember v2

Revember v2 is a local macOS app for solidifying technical fundamentals after first-principles learning sessions.

The app reads topic JSON files from:

```text
/Users/yash/Desktop/revember_v2_codex_project/RevemberKnowledge/topics
```

It writes progress locally to:

```text
~/Library/Application Support/RevemberV2/progress.json
```

There is no database, Firebase, backend, login, NLP service, or in-app AI generation. Codex updates the knowledge folder, and the app presents the preauthored concepts and multiple-choice checks.

## Run

```bash
./script/build_and_run.sh
```

## Test

```bash
swift test
```
