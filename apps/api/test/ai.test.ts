import { describe, expect, it } from "vitest";
import { MAX_TOKENS, classifyAiError } from "../src/ai.ts";

describe("classifyAiError", () => {
	it("3036 は無料枠超過（429）", () => {
		const result = classifyAiError(new Error("3036: You have used up your daily free allocation of 10,000 neurons."));
		expect(result).toMatchObject({ status: 429, code: "AI_QUOTA_EXCEEDED" });
	});

	it("5035 は有料プラン専用モデル（403）", () => {
		const result = classifyAiError(new Error("5035: This model requires a Workers Paid plan."));
		expect(result).toMatchObject({ status: 403, code: "MODEL_REQUIRES_PAID_PLAN" });
	});

	it("JSON Mode 失敗は AI_INVALID_OUTPUT", () => {
		expect(classifyAiError(new Error("JSON Mode couldn't be met"))).toMatchObject({ code: "AI_INVALID_OUTPUT" });
	});

	it("その他は AI_ERROR（502）", () => {
		expect(classifyAiError("network error")).toMatchObject({ status: 502, code: "AI_ERROR" });
	});
});

describe("MAX_TOKENS", () => {
	it("既定値（256）より大きい値を明示している", () => {
		for (const value of Object.values(MAX_TOKENS)) expect(value).toBeGreaterThan(256);
	});
});
