/** 各エンドポイント共通: 1日の Neurons 上限の確認と記録（CLAUDE.md 7.4） */
import { DAILY_LIMIT_MESSAGE, errorResponse } from "./errors.ts";
import { addNeurons, isWithinDailyLimit, parseDailyNeuronLimit } from "./usage.ts";

/** 上限に達していればエラーレスポンスを、まだ使えれば null を返す */
export async function dailyLimitResponse(env: Env): Promise<Response | null> {
	if (await isWithinDailyLimit(env.USAGE, parseDailyNeuronLimit(env.DAILY_NEURON_LIMIT))) return null;
	return errorResponse(429, "DAILY_LIMIT_REACHED", DAILY_LIMIT_MESSAGE);
}

/** 消費した Neurons を記録する（記録に失敗しても API の応答は止めない） */
export async function recordNeurons(env: Env, neurons: number | null, label: string): Promise<void> {
	if (neurons === null) {
		console.warn(`${label}: usage.neurons を取得できなかったため記録しません`);
		return;
	}
	try {
		await addNeurons(env.USAGE, neurons);
	} catch (error) {
		console.error(`${label}: Neurons の記録に失敗しました`, error);
	}
}
