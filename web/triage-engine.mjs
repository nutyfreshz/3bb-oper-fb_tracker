import { classificationInput, parseClassification, reviewInstruction } from "./triage.mjs";
import { CreateWebWorkerMLCEngine } from "./vendor-web-llm.mjs";

let worker;
let engine;

export async function loadClassifier(onProgress) {
  if (engine) return;
  const adapter = await navigator.gpu?.requestAdapter();
  if (!adapter) throw new Error("no-webgpu-adapter");
  const model = adapter.features.has("shader-f16")
    ? "Qwen3-4B-q4f16_1-MLC"
    : "Qwen3-4B-q4f32_1-MLC";
  worker = new Worker(new URL("./triage-worker.mjs", import.meta.url), { type: "module" });
  try {
    engine = await CreateWebWorkerMLCEngine(worker, model, {
      initProgressCallback: (event) => onProgress(Math.round(event.progress * 100)),
    });
  } catch (error) {
    worker.terminate();
    worker = undefined;
    throw error;
  }
}

async function askClassifier(instruction, input, grammar, maxTokens) {
  const response = await engine.chat.completions.create({
    messages: [{ role: "system", content: instruction }, { role: "user", content: input }],
    temperature: 0,
    max_tokens: maxTokens,
    response_format: { type: "grammar", grammar },
    extra_body: { enable_thinking: false },
  });
  return response.choices[0]?.message?.content?.trim();
}

export async function classifyPost(message) {
  if (message === "โพสต์มีสื่อประกอบ · เปิดลิงก์เพื่อดู" || !message.trim()) {
    return { technician_concern: "review", concern_evidence: "" };
  }
  const { instruction, input, grammar, excerpts } = classificationInput(message);
  const decision = parseClassification(await askClassifier(instruction, input, grammar, 12), excerpts);
  if (decision.technician_concern === "no") {
    const check = await askClassifier(reviewInstruction, JSON.stringify({ post: message }), "root ::= [ABC]", 1);
    if (check !== "C") return { technician_concern: "review", concern_evidence: "" };
  }
  return decision;
}
