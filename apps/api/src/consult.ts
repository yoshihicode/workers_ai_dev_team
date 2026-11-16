/**
 * 相談（CLAUDE.md 6.5 / 7.5）
 * - POST /api/agent/consult: SE / PG が着手前の質問を作る
 * - POST /api/agent/answer: PM / SE が質問に回答する
 */
import { callJsonWithRetry, runAnswer, runConsult } from "./ai.ts";
import { DAILY_LIMIT_MESSAGE, errorResponse } from "./errors.ts";
import type { AgentAnswerResponse, AgentConsultResponse } from "./types.ts";
import { parseDailyLimit, tryConsumeDailyCall } from "./usage.ts";
import {
	parseAnswerOutput,
	parseConsultOutput,
	validateAgentAnswerRequest,
	validateAgentConsultRequest,
} from "./validate.ts";

export async function handleAgentConsult(body: unknown, env: Env): Promise<Response> {
	const validated = validateAgentConsultRequest(body);
	if (!validated.ok) return errorResponse(400, validated.code, validated.message);

	if (!(await tryConsumeDailyCall(env.USAGE, parseDailyLimit(env.DAILY_AI_CALL_LIMIT)))) {
		return errorResponse(429, "DAILY_LIMIT_REACHED", DAILY_LIMIT_MESSAGE);
	}

	const { role, input, priorQa } = validated.value;
	const result = await callJsonWithRetry(
		`${role} consult`,
		() => runConsult(env.AI, role, input, priorQa),
		(response) => parseConsultOutput(response, role),
	);
	if (!result.ok) return errorResponse(result.error.status, result.error.code, result.error.message);
	const payload: AgentConsultResponse = { questions: result.value };
	return Response.json(payload);
}

export async function handleAgentAnswer(body: unknown, env: Env): Promise<Response> {
	const validated = validateAgentAnswerRequest(body);
	if (!validated.ok) return errorResponse(400, validated.code, validated.message);

	if (!(await tryConsumeDailyCall(env.USAGE, parseDailyLimit(env.DAILY_AI_CALL_LIMIT)))) {
		return errorResponse(429, "DAILY_LIMIT_REACHED", DAILY_LIMIT_MESSAGE);
	}

	const req = validated.value;
	const result = await callJsonWithRetry(
		`${req.role} answer`,
		() => runAnswer(env.AI, req),
		(response) => parseAnswerOutput(response, req.questions),
	);
	if (!result.ok) return errorResponse(result.error.status, result.error.code, result.error.message);
	const payload: AgentAnswerResponse = { answers: result.value };
	return Response.json(payload);
}
