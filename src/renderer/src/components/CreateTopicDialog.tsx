import { useState } from "react";
import type { FormEvent } from "react";
import { BookOpen, Plus } from "lucide-react";
import type { CreateTopicInput, CreateTopicResult } from "../../../../shared/types";
import { Modal } from "./modal";
import { InlineError } from "./review-ui";
import { toErrorMessage } from "../utils";

export function CreateTopicDialog({ onCreated, onClose }: {
  onCreated: (result: CreateTopicResult) => void;
  onClose: () => void;
}) {
  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!title.trim() || saving) return;
    setSaving(true);
    setError(undefined);
    try {
      const input: CreateTopicInput = { title, summary };
      const result = await window.revember.createTopic(input);
      onCreated(result);
    } catch (cause) {
      setError(toErrorMessage(cause));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title="New topic" icon={<BookOpen />} closeOnBackdrop={!saving} onClose={onClose}>
      <form className="create-topic-form" onSubmit={(event) => void submit(event)}>
        <label>
          <span>Topic name</span>
          <input
            autoFocus
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="e.g. Operating Systems"
            maxLength={120}
            required
          />
        </label>
        <label>
          <span>Short description <small>Optional</small></span>
          <textarea
            value={summary}
            onChange={(event) => setSummary(event.target.value)}
            placeholder="What will this topic help you understand?"
            maxLength={500}
            rows={4}
          />
        </label>
        <p className="create-topic-hint">The topic starts empty. Add review questions as you learn.</p>
        {error && <InlineError message={error} />}
        <div className="dialog-footer">
          <button type="button" onClick={onClose} disabled={saving}>Cancel</button>
          <button type="submit" className="primary" disabled={saving || !title.trim()}>
            <Plus /> {saving ? "Creating…" : "Create topic"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
