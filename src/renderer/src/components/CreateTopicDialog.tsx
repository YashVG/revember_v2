import { useState } from "react";
import type { FormEvent } from "react";
import { BookOpen, Plus } from "lucide-react";
import type { CreateTopicInput, CreateTopicResult } from "../../../../shared/types";
import { Modal } from "./modal";
import { InlineError } from "./review-ui";
import { useAsyncAction } from "../hooks/useAsyncAction";

export function CreateTopicDialog({ onCreated, onClose }: {
  onCreated: (result: CreateTopicResult) => void;
  onClose: () => void;
}) {
  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("");
  const { pending: saving, error, run } = useAsyncAction();

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!title.trim() || saving) return;
    const result = await run(async () => {
      const input: CreateTopicInput = { title, summary };
      return window.revember.createTopic(input);
    });
    if (result) onCreated(result);
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
