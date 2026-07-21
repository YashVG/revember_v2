import { Brain, CircleAlert } from "lucide-react";

export function RecallGate({ description, onReveal }: { description: string; onReveal: () => void }) {
  return <div className="recall-box">
    <Brain />
    <h3>Recall before cues</h3>
    <p>{description}</p>
    <button className="primary" onClick={onReveal}>Reveal Choices</button>
  </div>;
}

export function InlineError({ message }: { message: string }) {
  return <div className="inline-error" role="alert"><CircleAlert /> {message}</div>;
}
