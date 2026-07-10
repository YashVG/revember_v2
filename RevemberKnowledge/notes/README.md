# Revember Knowledge Notes

This folder holds LLM-friendly source notes.

Use these Markdown files for:

- first-principles explanations
- session summaries
- examples and analogies
- user confusions
- open questions
- long-form concept context

The app does not parse this folder directly. App-ready review material lives in:

```text
../topics/*.json
```

Workflow:

```text
Codex learning session -> update notes/*.md -> compile/update topics/*.json -> Revember displays checks
```

For the full learning-session protocol, see:

```text
../LEARNING_WORKFLOW.md
```

Keep Markdown expressive and forgiving. Keep JSON strict, stable, and app-readable.
