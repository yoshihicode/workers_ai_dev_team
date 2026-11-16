/** POST /api/agent/review（CLAUDE.md 6.6 / 7.6）: SE / PM が PG のソースコードをレビューする */
import { callJsonWithRetry, runReview } from "./ai.ts";
import { errorResponse } from "./errors.ts";
import { dailyLimitResponse, recordNeurons } from "./quota.ts";
import type { AgentReviewResponse } from "./types.ts";
import { parseReviewOutput, validateAgentReviewRequest } from "./validate.ts";

export async function handleAgentReview(body: unknown, env: Env): Promise<Response> {
	const validated = validateAgentReviewRequest(body);
	if (!validated.ok) return errorResponse(400, validated.code, validated.message);

	const limited = await dailyLimitResponse(env);
	if (limited) return limited;

	const req = validated.value;
	const label = `${req.role} review`;
	const result = await callJsonWithRetry(label, () => runReview(env.AI, req), parseReviewOutput);
	await recordNeurons(env, result.neurons, label);
	if (!result.ok) return errorResponse(result.error.status, result.error.code, result.error.message);
	return Response.json(result.value satisfies AgentReviewResponse);
}
