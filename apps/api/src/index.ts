/** api Worker のエントリポイント（Hono アプリ・ルーティング） */
import { Hono } from "hono";
import { handleAgentWork } from "./agent.ts";
import { handleAgentAnswer, handleAgentConsult } from "./consult.ts";
import { errorResponse } from "./errors.ts";
import { handlePmChat } from "./pm.ts";

const app = new Hono<{ Bindings: Env }>();

async function readJson(req: Request): Promise<unknown> {
	try {
		return await req.json();
	} catch {
		return undefined;
	}
}

app.post("/api/pm/chat", async (c) => handlePmChat(await readJson(c.req.raw), c.env));
app.post("/api/agent/work", async (c) => handleAgentWork(await readJson(c.req.raw), c.env));
app.post("/api/agent/consult", async (c) => handleAgentConsult(await readJson(c.req.raw), c.env));
app.post("/api/agent/answer", async (c) => handleAgentAnswer(await readJson(c.req.raw), c.env));

app.notFound(() => errorResponse(404, "INVALID_REQUEST", "Not Found"));
app.onError((error) => {
	console.error("Unhandled error", error);
	return errorResponse(500, "AI_ERROR", "サーバーでエラーが発生しました。");
});

export default app;
