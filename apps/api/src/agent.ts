/** POST /api/agent/work（CLAUDE.md 7.2） */
import { classifyAiError, runAgentStream } from "./ai.ts";
import { DAILY_LIMIT_MESSAGE, errorResponse } from "./errors.ts";
import { parseDailyLimit, tryConsumeDailyCall } from "./usage.ts";
import { validateAgentWorkRequest } from "./validate.ts";

export async function handleAgentWork(body: unknown, env: Env): Promise<Response> {
	const validated = validateAgentWorkRequest(body);
	if (!validated.ok) return errorResponse(400, validated.code, validated.message);

	if (!(await tryConsumeDailyCall(env.USAGE, parseDailyLimit(env.DAILY_AI_CALL_LIMIT)))) {
		return errorResponse(429, "DAILY_LIMIT_REACHED", DAILY_LIMIT_MESSAGE);
	}

	try {
		const { role, input, qa } = validated.value;
		const stream = await runAgentStream(env.AI, role, input, qa);
		// CPU 時間節約のため、チャンクを加工せずそのまま中継する（CLAUDE.md 3.1）
		return new Response(stream, {
			headers: {
				"content-type": "text/event-stream; charset=utf-8",
				"cache-control": "no-cache",
			},
		});
	} catch (error) {
		console.error("Agent call failed", error);
		const classified = classifyAiError(error);
		return errorResponse(classified.status, classified.code, classified.message);
	}
}
