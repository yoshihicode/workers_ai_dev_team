/**
 * 相談（CLAUDE.md 6.5 / 7.5）
 * - POST /api/agent/consult: SE / PG が着手前の質問を作る
 * - POST /api/agent/answer: PM / SE が質問に回答する
 */
import { callJsonWithRetry, runAnswer, runConsult } from "./ai.ts";
import { errorResponse } from "./errors.ts";
import { dailyLimitResponse, recordNeurons } from "./quota.ts";
import type { AgentAnswerResponse, AgentConsultResponse } from "./types.ts";
import {
	parseAnswerOutput,
	parseConsultOutput,
	validateAgentAnswerRequest,
	validateAgentConsultRequest,
} from "./validate.ts";

export async function handleAgentConsult(body: unknown, env: Env): Promise<Response> {
	const validated = validateAgentConsultRequest(body);
	if (!validated.ok) return errorResponse(400, validated.code, validated.message);

	const limited = await dailyLimitResponse(env);
	if (limited) return limited;

	const { role, input, priorQa } = validated.value;
	const label = `${role} consult`;
	const result = await callJsonWithRetry(
		label,
		() => runConsult(env.AI, role, input, priorQa),
		(response) => parseConsultOutput(response, role),
	);
	await recordNeurons(env, result.neurons, label);
	if (!result.ok) return errorResponse(result.error.status, result.error.code, result.error.message);
	const payload: AgentConsultResponse = { questions: result.value };
	return Response.json(payload);
}

export async function handleAgentAnswer(body: unknown, env: Env): Promise<Response> {
	const validated = validateAgentAnswerRequest(body);
	if (!validated.ok) return errorResponse(400, validated.code, validated.message);

	const limited = await dailyLimitResponse(env);
	if (limited) return limited;

	const req = validated.value;
	const label = `${req.role} answer`;
	const result = await callJsonWithRetry(
		label,
		() => runAnswer(env.AI, req),
		(response) => parseAnswerOutput(response, req.questions),
	);
	await recordNeurons(env, result.neurons, label);
	if (!result.ok) return errorResponse(result.error.status, result.error.code, result.error.message);
	const payload: AgentAnswerResponse = { answers: result.value };
	return Response.json(payload);
}
