/** POST /api/pm/chat（CLAUDE.md 7.1） */
import { callJsonWithRetry, runPm } from "./ai.ts";
import { errorResponse } from "./errors.ts";
import { dailyLimitResponse, recordNeurons } from "./quota.ts";
import type { PmChatResponse } from "./types.ts";
import { parsePmOutput, validatePmChatRequest } from "./validate.ts";

export async function handlePmChat(body: unknown, env: Env): Promise<Response> {
	const validated = validatePmChatRequest(body);
	if (!validated.ok) return errorResponse(400, validated.code, validated.message);

	const limited = await dailyLimitResponse(env);
	if (limited) return limited;

	const result = await callJsonWithRetry("PM", () => runPm(env.AI, validated.value.messages), parsePmOutput);
	await recordNeurons(env, result.neurons, "PM");
	if (!result.ok) return errorResponse(result.error.status, result.error.code, result.error.message);
	return Response.json(result.value satisfies PmChatResponse);
}
