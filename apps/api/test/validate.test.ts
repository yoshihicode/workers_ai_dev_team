import { describe, expect, it } from "vitest";
import {
	MAX_INPUT_CHARS,
	PM_COMPLETED_MESSAGE,
	parsePmOutput,
	validateAgentWorkRequest,
	validatePmChatRequest,
} from "../src/validate.ts";

describe("validatePmChatRequest", () => {
	it("正しいリクエストを受け付ける", () => {
		const result = validatePmChatRequest({ messages: [{ role: "user", content: "TODOアプリを作りたい" }] });
		expect(result.ok).toBe(true);
	});

	it.each([
		["body なし", undefined],
		["messages が配列でない", { messages: "x" }],
		["空配列", { messages: [] }],
		["role 不正", { messages: [{ role: "system", content: "x" }] }],
		["content が文字列でない", { messages: [{ role: "user", content: 1 }] }],
		["最後が assistant", { messages: [{ role: "assistant", content: "x" }] }],
	])("%s は INVALID_REQUEST", (_, body) => {
		const result = validatePmChatRequest(body);
		expect(result).toMatchObject({ ok: false, code: "INVALID_REQUEST" });
	});

	it("長すぎる会話は INPUT_TOO_LONG", () => {
		const result = validatePmChatRequest({ messages: [{ role: "user", content: "a".repeat(MAX_INPUT_CHARS + 1) }] });
		expect(result).toMatchObject({ ok: false, code: "INPUT_TOO_LONG" });
	});
});

describe("validateAgentWorkRequest", () => {
	it("SE / PG を受け付ける", () => {
		expect(validateAgentWorkRequest({ role: "SE", input: "要件" }).ok).toBe(true);
		expect(validateAgentWorkRequest({ role: "PG", input: "設計" }).ok).toBe(true);
	});

	it("role 不正・input 空は INVALID_REQUEST", () => {
		expect(validateAgentWorkRequest({ role: "PM", input: "x" })).toMatchObject({ code: "INVALID_REQUEST" });
		expect(validateAgentWorkRequest({ role: "SE", input: "  " })).toMatchObject({ code: "INVALID_REQUEST" });
	});

	it("長すぎる input は INPUT_TOO_LONG", () => {
		const result = validateAgentWorkRequest({ role: "SE", input: "a".repeat(MAX_INPUT_CHARS + 1) });
		expect(result).toMatchObject({ code: "INPUT_TOO_LONG" });
	});
});

describe("parsePmOutput", () => {
	it("hearing のときは requirements を null にする", () => {
		expect(parsePmOutput({ status: "hearing", message: "誰が使いますか？", requirements: "x" })).toEqual({
			status: "hearing",
			message: "誰が使いますか？",
			requirements: null,
		});
	});

	it("completed で requirements があれば受け付ける", () => {
		const output = { status: "completed", message: "完了", requirements: "# 要件定義書" };
		expect(parsePmOutput(output)).toEqual(output);
	});

	it("completed で message が空なら既定の文言で補う（実機で確認した形式）", () => {
		const result = parsePmOutput({ status: "completed", message: "", requirements: "# 要件定義書" });
		expect(result).toEqual({ status: "completed", message: PM_COMPLETED_MESSAGE, requirements: "# 要件定義書" });
	});

	it("rejected のときは requirements を null にする", () => {
		expect(parsePmOutput({ status: "rejected", message: "対象外です。", requirements: "x" })).toEqual({
			status: "rejected",
			message: "対象外です。",
			requirements: null,
		});
	});

	it("JSON 文字列でも解釈できる", () => {
		const output = { status: "hearing", message: "質問", requirements: null };
		expect(parsePmOutput(JSON.stringify(output))).toEqual(output);
	});

	it.each([
		["壊れた JSON 文字列", "{"],
		["status 不正", { status: "done", message: "x", requirements: null }],
		["completed なのに requirements なし", { status: "completed", message: "x", requirements: null }],
		["message なし", { status: "hearing", requirements: null }],
		["hearing で message が空", { status: "hearing", message: " ", requirements: null }],
		["rejected で message が空", { status: "rejected", message: "", requirements: null }],
	])("%s は null", (_, output) => {
		expect(parsePmOutput(output)).toBeNull();
	});
});
