import { mutateTopicJson } from "../../topic-authoring/index.js";

const [knowledgeRoot, topicPath, topicID, expectedRevisionText, summary] = process.argv.slice(2);

try {
  const result = await mutateTopicJson({
    knowledgeRoot,
    topicPath,
    topicID,
    expectedRevision: Number(expectedRevisionText),
    transform: async (topic) => {
      // Hold the lock briefly so both OS processes demonstrably contend for it.
      await new Promise((resolve) => setTimeout(resolve, 100));
      return { ...topic, summary };
    },
    validate: (topic) => {
      if (topic.id !== topicID || !Array.isArray(topic.concepts) || !Array.isArray(topic.questions)) {
        throw new Error("Worker produced an invalid topic.");
      }
    }
  });
  process.stdout.write(JSON.stringify({ revision: result.revision, summary }));
} catch (error) {
  process.stderr.write(error instanceof Error ? error.message : String(error));
  process.exitCode = 2;
}
