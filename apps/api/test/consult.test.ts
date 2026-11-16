import { describe, expect, it } from "vitest";
import { buildAnswerInput, buildConsultInput, buildReviewInput, buildWorkInput, callJsonWithRetry } from "../src/ai.ts";
import {
	NO_ANSWER,
	normalizeAnswer,
	parseAnswerOutput,
	parseConsultOutput,
	parseReviewOutput,
	validateAgentReviewRequest,
	validateAgentAnswerRequest,
	validateAgentConsultRequest,
	validateAgentWorkRequest,
} from "../src/validate.ts";

describe("validateAgentConsultRequest", () => {
	it("SE / PG と input を受け付ける", () => {
		expect(validateAgentConsultRequest({ role: "SE", input: "要件" }).ok).toBe(true);
		expect(validateAgentConsultRequest({ role: "PG", input: "設計" }).ok).toBe(true);
	});
	it("role 不正は INVALID_REQUEST", () => {
		expect(validateAgentConsultRequest({ role: "PM", input: "x" })).toMatchObject({ code: "INVALID_REQUEST" });
	});
});

describe("validateAgentAnswerRequest", () => {
	const base = { role: "PM", from: "SE", questions: ["保存形式は？"], requirements: "# 要件" };

	it("PM が SE の質問に回答するリクエストを受け付ける", () => {
		expect(validateAgentAnswerRequest(base).ok).toBe(true);
	});

	it("ヒアリング記録付きでも受け付ける", () => {
		const result = validateAgentAnswerRequest({ ...base, messages: [{ role: "user", content: "x" }] });
		expect(result.ok).toBe(true);
	});

	it("SE が回答する場合は PG からの質問と設計書が必要", () => {
		expect(validateAgentAnswerRequest({ ...base, role: "SE", from: "SE", design: "# 設計" })).toMatchObject({
			code: "INVALID_REQUEST",
		});
		expect(validateAgentAnswerRequest({ ...base, role: "SE", from: "PG" })).toMatchObject({ code: "INVALID_REQUEST" });
		expect(validateAgentAnswerRequest({ ...base, role: "SE", from: "PG", design: "# 設計" }).ok).toBe(true);
	});

	it.each([
		["質問なし", { ...base, questions: [] }],
		["質問が4件", { ...base, questions: ["a", "b", "c", "d"] }],
		["要件定義書なし", { ...base, requirements: "" }],
		["from 不正", { ...base, from: "PM" }],
	])("%s は INVALID_REQUEST", (_, body) => {
		expect(validateAgentAnswerRequest(body)).toMatchObject({ code: "INVALID_REQUEST" });
	});
});

describe("validateAgentWorkRequest（qa 付き）", () => {
	it("qa を受け付ける", () => {
		const result = validateAgentWorkRequest({ role: "SE", input: "要件", qa: [{ question: "Q", answer: "A" }] });
		expect(result).toMatchObject({ ok: true, value: { qa: [{ question: "Q", answer: "A" }] } });
	});
	it("qa の形式が不正なら INVALID_REQUEST", () => {
		expect(validateAgentWorkRequest({ role: "SE", input: "要件", qa: [{ question: "Q" }] })).toMatchObject({
			code: "INVALID_REQUEST",
		});
	});
});

describe("parseConsultOutput", () => {
	it("質問を取り出し、最大3件で切る", () => {
		const questions = [1, 2, 3, 4].map((n) => ({ to: "PM", question: `Q${n}` }));
		expect(parseConsultOutput({ questions }, "SE")).toHaveLength(3);
	});

	it("SE の質問は宛先を PM に固定する", () => {
		expect(parseConsultOutput({ questions: [{ to: "SE", question: "Q" }] }, "SE")).toEqual([{ to: "PM", question: "Q" }]);
	});

	it("PG の質問は SE / PM の宛先を保つ（不明な宛先は PM）", () => {
		const output = { questions: [{ to: "SE", question: "A" }, { to: "PM", question: "B" }, { to: "XX", question: "C" }] };
		expect(parseConsultOutput(output, "PG")?.map((q) => q.to)).toEqual(["SE", "PM", "PM"]);
	});

	it("空の質問は捨て、質問なしは空配列", () => {
		expect(parseConsultOutput({ questions: [{ to: "PM", question: " " }] }, "SE")).toEqual([]);
		expect(parseConsultOutput({ questions: [] }, "PG")).toEqual([]);
	});

	it("全体の形式が不正なら null", () => {
		expect(parseConsultOutput({ q: [] }, "SE")).toBeNull();
		expect(parseConsultOutput("{", "SE")).toBeNull();
	});
});

describe("parseAnswerOutput", () => {
	it("質問と回答を組にする", () => {
		expect(parseAnswerOutput({ answers: ["A1", "A2"] }, ["Q1", "Q2"])).toEqual([
			{ question: "Q1", answer: "A1" },
			{ question: "Q2", answer: "A2" },
		]);
	});
	it("足りない回答は NO_ANSWER で補う", () => {
		expect(parseAnswerOutput({ answers: ["A1"] }, ["Q1", "Q2"])?.[1]?.answer).toBe(NO_ANSWER);
	});
	it("形式が不正なら null", () => {
		expect(parseAnswerOutput({ answer: "x" }, ["Q1"])).toBeNull();
	});
});

describe("buildWorkInput", () => {
	it("回答がなければ入力そのまま", () => {
		expect(buildWorkInput("# 要件", undefined)).toBe("# 要件");
		expect(buildWorkInput("# 要件", [])).toBe("# 要件");
	});
	it("回答を末尾に付け加える", () => {
		const text = buildWorkInput("# 要件", [{ question: "保存先は？", answer: "localStorage" }]);
		expect(text).toContain("# 要件");
		expect(text).toContain("着手前の確認事項と回答");
		expect(text).toContain("保存先は？");
		expect(text).toContain("localStorage");
	});
});

describe("buildAnswerInput", () => {
	it("PM の回答にはヒアリング記録を含める", () => {
		const text = buildAnswerInput({
			role: "PM",
			from: "SE",
			questions: ["Q1"],
			requirements: "# 要件",
			messages: [{ role: "user", content: "家計簿を作りたい" }],
		});
		expect(text).toContain("ヒアリング記録");
		expect(text).toContain("ユーザー: 家計簿を作りたい");
		expect(text).toContain("SEからの質問");
	});
	it("SE の回答には設計書を含め、ヒアリング記録は含めない", () => {
		const text = buildAnswerInput({
			role: "SE",
			from: "PG",
			questions: ["Q1"],
			requirements: "# 要件",
			design: "# 設計",
			messages: [{ role: "user", content: "x" }],
		});
		expect(text).toContain("# 設計");
		expect(text).not.toContain("ヒアリング記録");
		expect(text).toContain("PGからの質問");
	});
});

describe("callJsonWithRetry", () => {
	it("不正な出力なら1回だけ再試行する", async () => {
		let calls = 0;
		const result = await callJsonWithRetry(
			"test",
			async () => ({ response: ++calls === 1 ? "broken" : { ok: 1 }, neurons: 10 }),
			(r) => (typeof r === "object" ? r : null),
		);
		expect(calls).toBe(2);
		expect(result.ok).toBe(true);
		// 再試行分も含めた Neurons を返す
		expect(result.neurons).toBe(20);
	});

	it("2回とも不正なら AI_INVALID_OUTPUT", async () => {
		const result = await callJsonWithRetry("test", async () => ({ response: "broken", neurons: 5 }), () => null);
		expect(result).toMatchObject({ ok: false, error: { code: "AI_INVALID_OUTPUT" } });
	});

	it("無料枠超過は再試行せずに返す", async () => {
		let calls = 0;
		const result = await callJsonWithRetry(
			"test",
			async () => {
				calls++;
				throw new Error("3036: daily free allocation");
			},
			() => null,
		);
		expect(calls).toBe(1);
		expect(result).toMatchObject({ ok: false, error: { code: "AI_QUOTA_EXCEEDED" } });
	});
});

describe("normalizeAnswer（実機で返った形式）", () => {
	it.each([
		["1. JSON形式で保存します。", "JSON形式で保存します。"],
		["2. (仮定) 自由に追加できます。", "（仮定）自由に追加できます。"],
		["(仮定)3. ポップアップを表示します。", "（仮定）ポップアップを表示します。"],
		["（仮定）制限しません。", "（仮定）制限しません。"],
		["2026年に対応します。", "2026年に対応します。"],
	])("%s → %s", (input, expected) => {
		expect(normalizeAnswer(input)).toBe(expected);
	});
});

describe("priorQa（SE 工程の相談結果）", () => {
	const prior = [{ question: "カテゴリは？", answer: "事前定義のリストから選ぶ" }];

	it("consult と answer で受け付ける", () => {
		expect(validateAgentConsultRequest({ role: "PG", input: "# 設計", priorQa: prior })).toMatchObject({
			ok: true,
			value: { priorQa: prior },
		});
		expect(
			validateAgentAnswerRequest({ role: "PM", from: "PG", questions: ["Q"], requirements: "# 要件", priorQa: prior }),
		).toMatchObject({ ok: true, value: { priorQa: prior } });
	});

	it("形式が不正なら INVALID_REQUEST", () => {
		expect(validateAgentConsultRequest({ role: "PG", input: "x", priorQa: [{ q: 1 }] })).toMatchObject({
			code: "INVALID_REQUEST",
		});
	});

	it("質問作成・回答の入力に「これまでの相談で決まった事項」として含める", () => {
		expect(buildConsultInput("# 設計", prior)).toContain("これについては質問しないでください");
		expect(buildConsultInput("# 設計", prior)).toContain("事前定義のリストから選ぶ");
		const answerInput = buildAnswerInput({ role: "SE", from: "PG", questions: ["Q"], requirements: "# 要件", design: "# 設計", priorQa: prior });
		expect(answerInput).toContain("これまでの相談で決まった事項");
		expect(answerInput).toContain("事前定義のリストから選ぶ");
	});
});

describe("validateAgentReviewRequest", () => {
	const base = { role: "SE", code: "```ts\nconst a = 1;\n```", requirements: "# 要件", design: "# 設計" };

	it("SE（設計書付き）と PM（ヒアリング記録付き）を受け付ける", () => {
		expect(validateAgentReviewRequest(base).ok).toBe(true);
		expect(
			validateAgentReviewRequest({ role: "PM", code: "x", requirements: "# 要件", messages: [{ role: "user", content: "家計簿" }] }).ok,
		).toBe(true);
	});

	it.each([
		["role 不正", { ...base, role: "PG" }],
		["code なし", { ...base, code: "" }],
		["SE なのに設計書なし", { ...base, design: undefined }],
		["要件定義書なし", { ...base, requirements: " " }],
	])("%s は INVALID_REQUEST", (_, body) => {
		expect(validateAgentReviewRequest(body)).toMatchObject({ code: "INVALID_REQUEST" });
	});
});

describe("parseReviewOutput", () => {
	it("指摘があれば changes_requested（番号は取り除き、最大5件）", () => {
		const comments = ["1. 削除機能がない", "2. 合計の計算が誤り", "c", "d", "e", "f"];
		const result = parseReviewOutput({ verdict: "changes_requested", comments });
		expect(result?.verdict).toBe("changes_requested");
		expect(result?.comments).toHaveLength(5);
		expect(result?.comments[0]).toBe("削除機能がない");
	});

	it("approved のときは感想が添えられていても指摘なしにする", () => {
		expect(parseReviewOutput({ verdict: "approved", comments: ["よくできています"] })).toEqual({
			verdict: "approved",
			comments: [],
		});
	});

	it("changes_requested でも指摘がなければ approved", () => {
		expect(parseReviewOutput({ verdict: "changes_requested", comments: [] })).toEqual({ verdict: "approved", comments: [] });
	});

	it("形式が不正なら null", () => {
		expect(parseReviewOutput({ verdict: "ok", comments: [] })).toBeNull();
		expect(parseReviewOutput({ verdict: "approved" })).toBeNull();
	});
});

describe("validateAgentWorkRequest（review 付き）", () => {
	const review = { previousCode: "old code", comments: [{ reviewer: "SE", comment: "削除機能を追加" }] };

	it("PG の作り直しを受け付ける", () => {
		expect(validateAgentWorkRequest({ role: "PG", input: "# 設計", review })).toMatchObject({ ok: true, value: { review } });
	});

	it("SE には指定できない・形式が不正なら INVALID_REQUEST", () => {
		expect(validateAgentWorkRequest({ role: "SE", input: "# 要件", review })).toMatchObject({ code: "INVALID_REQUEST" });
		expect(
			validateAgentWorkRequest({ role: "PG", input: "# 設計", review: { previousCode: "x", comments: [] } }),
		).toMatchObject({ code: "INVALID_REQUEST" });
	});
});

describe("buildWorkInput（作り直し）/ buildReviewInput", () => {
	it("修正前のコードと指摘を付ける", () => {
		const text = buildWorkInput("# 設計", undefined, {
			previousCode: "const a = 1;",
			comments: [{ reviewer: "PM", comment: "削除機能を追加" }],
		});
		expect(text).toContain("修正前のソースコード");
		expect(text).toContain("const a = 1;");
		expect(text).toContain("[PM] 削除機能を追加");
		expect(text).toContain("すべてのファイルを省略せずに");
	});

	it("SE のレビューには設計書、PM のレビューにはヒアリング記録を含める", () => {
		const common = { code: "CODE", requirements: "# 要件", design: "# 設計", messages: [{ role: "user" as const, content: "家計簿" }] };
		const se = buildReviewInput({ role: "SE", ...common });
		const pm = buildReviewInput({ role: "PM", ...common });
		expect(se).toContain("# 設計");
		expect(se).not.toContain("ヒアリング記録");
		expect(pm).toContain("ヒアリング記録");
		expect(pm).not.toContain("# 設計書");
		expect(pm).toContain("CODE");
	});
});
