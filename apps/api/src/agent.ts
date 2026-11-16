/** POST /api/agent/work（CLAUDE.md 7.2） */
import { classifyAiError, runAgentStream } from "./ai.ts";
import { errorResponse } from "./errors.ts";
import { dailyLimitResponse, recordNeurons } from "./quota.ts";
import { trackStreamNeurons } from "./usage.ts";
import { validateAgentWorkRequest } from "./validate.ts";

/** 応答の後も処理を続けるために使う部分だけ（Hono の executionCtx） */
interface WaitUntil {
	waitUntil(promise: Promise<unknown>): void;
}

export async function handleAgentWork(body: unknown, env: Env, ctx: WaitUntil): Promise<Response> {
	const validated = validateAgentWorkRequest(body);
	if (!validated.ok) return errorResponse(400, validated.code, validated.message);

	const limited = await dailyLimitResponse(env);
	if (limited) return limited;

	const { role, input, qa, review } = validated.value;
	const label = review ? `${role} fix` : `${role} work`;
	try {
		const source = await runAgentStream(env.AI, role, input, qa, review);
		// CPU 時間節約のため、チャンクは加工せずそのまま中継する（CLAUDE.md 3.1）。
		// Neurons は複製したストリームの末尾だけを読んで、応答の後に記録する。
		const { stream, done } = trackStreamNeurons(source, (neurons) => recordNeurons(env, neurons, label));
		ctx.waitUntil(done);
		return new Response(stream, {
			headers: {
				"content-type": "text/event-stream; charset=utf-8",
				"cache-control": "no-cache",
			},
		});
	} catch (error) {
		console.error(`${label} call failed`, error);
		const classified = classifyAiError(error);
		return errorResponse(classified.status, classified.code, classified.message);
	}
}
