import { WebWorkerMLCEngineHandler } from "./vendor-web-llm.mjs";

const handler = new WebWorkerMLCEngineHandler();
self.onmessage = (event) => handler.onmessage(event);
