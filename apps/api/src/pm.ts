/** POST /api/pm/chat（CLAUDE.md 7.1） */
import { callJsonWithRetry, runPm } from "./ai.ts";
import { DAILY_LIMIT_MESSAGE, errorResponse } from "./errors.ts";
import type { PmChatResponse } from "./types.ts";
import { parseDailyLimit, tryConsumeDailyCall } from "./usage.ts";
import { parsePmOutput, validatePmChatRequest } from "./validate.ts";

export async function handlePmChat(body: unknown, env: Env): Promise<Response> {
	const validated = validatePmChatRequest(body);
	if (!validated.ok) return errorResponse(400, validated.code, validated.message);

	if (!(await tryConsumeDailyCall(env.USAGE, parseDailyLimit(env.DAILY_AI_CALL_LIMIT)))) {
		return errorResponse(429, "DAILY_LIMIT_REACHED", DAILY_LIMIT_MESSAGE);
	}

	const result = await callJsonWithRetry("PM", () => runPm(env.AI, validated.value.messages), parsePmOutput);
	if (!result.ok) return errorResponse(result.error.status, result.error.code, result.error.message);
	return Response.json(result.value satisfies PmChatResponse);
}
