import { describe, expect, it, vi } from "vitest";
import type { AgentAnswerRequest, ConsultQuestion } from "@workers-ai-dev-team/api/types";
import { ApiError } from "../src/lib/api.ts";
import type { ConsultationRound } from "../src/lib/consultation.ts";
import { ANSWER_FAILED, CONSULT_FAILED_NOTE, runConsultation, type ConsultationDeps } from "../src/lib/pipeline.ts";

function setup(questions: ConsultQuestion[] | Error, answer?: (req: AgentAnswerRequest) => string[] | Error) {
	const rounds: ConsultationRound[] = [];
	const answerCalls: AgentAnswerRequest[] = [];
	const deps: ConsultationDeps = {
		postConsult: vi.fn(async () => {
			if (questions instanceof Error) throw questions;
			return questions;
		}),
		postAnswer: vi.fn(async (req: AgentAnswerRequest) => {
			answerCalls.push(req);
			const result = answer?.(req) ?? req.questions.map((q) => `${req.role}: ${q} への回答`);
			if (result instanceof Error) throw result;
			return req.questions.map((question, i) => ({ question, answer: result[i] ?? "" }));
		}),
	};
	const params = {
		requirements: "# 要件",
		messages: [{ role: "user" as const, content: "家計簿" }],
		onRound: (r: ConsultationRound) => rounds.push(r),
		deps,
	};
	return { rounds, answerCalls, deps, params };
}

describe("runConsultation", () => {
	it("質問がなければ回答を求めずに空配列を返す", async () => {
		const { rounds, deps, params } = setup([]);
		const qa = await runConsultation({ ...params, role: "SE", input: "# 要件" });
		expect(qa).toEqual([]);
		expect(deps.postAnswer).not.toHaveBeenCalled();
		expect(rounds.map((r) => r.status)).toEqual(["consulting", "done"]);
	});

	it("SE の質問は PM がヒアリング記録付きで回答する", async () => {
		const { rounds, answerCalls, params } = setup([{ to: "PM", question: "保存期間は？" }]);
		const qa = await runConsultation({ ...params, role: "SE", input: "# 要件" });
		expect(answerCalls).toHaveLength(1);
		expect(answerCalls[0]).toMatchObject({ role: "PM", from: "SE", questions: ["保存期間は？"] });
		expect(answerCalls[0]?.messages).toHaveLength(1);
		expect(qa).toEqual([{ question: "保存期間は？", answer: "PM: 保存期間は？ への回答" }]);
		expect(rounds.map((r) => r.status)).toEqual(["consulting", "answering", "done"]);
	});

	it("PG の質問は宛先ごとに SE（設計書付き）と PM に分けて回答をもらい、元の順番で返す", async () => {
		const { answerCalls, params } = setup([
			{ to: "SE", question: "Q1" },
			{ to: "PM", question: "Q2" },
			{ to: "SE", question: "Q3" },
		]);
		const qa = await runConsultation({ ...params, role: "PG", input: "# 設計", design: "# 設計" });
		const se = answerCalls.find((c) => c.role === "SE");
		const pm = answerCalls.find((c) => c.role === "PM");
		expect(se).toMatchObject({ from: "PG", questions: ["Q1", "Q3"], design: "# 設計" });
		expect(se?.messages).toBeUndefined();
		expect(pm).toMatchObject({ from: "PG", questions: ["Q2"] });
		expect(pm?.design).toBeUndefined();
		expect(qa.map((x) => x.answer)).toEqual(["SE: Q1 への回答", "PM: Q2 への回答", "SE: Q3 への回答"]);
	});

	it("質問の作成で AI の出力が解釈できなかった場合は相談を省略して進める", async () => {
		const { rounds, params } = setup(new ApiError("AI_INVALID_OUTPUT", "x"));
		const qa = await runConsultation({ ...params, role: "SE", input: "# 要件" });
		expect(qa).toEqual([]);
		expect(rounds.at(-1)).toMatchObject({ status: "skipped", note: CONSULT_FAILED_NOTE });
	});

	it("回答の作成で AI の出力が解釈できなかった場合は「回答なし」として進める", async () => {
		const { params } = setup([{ to: "PM", question: "Q" }], () => new ApiError("AI_INVALID_OUTPUT", "x"));
		const qa = await runConsultation({ ...params, role: "SE", input: "# 要件" });
		expect(qa).toEqual([{ question: "Q", answer: ANSWER_FAILED }]);
	});

	it("利用上限などのエラーは呼び出し元に伝える（工程を止める）", async () => {
		const { params } = setup(new ApiError("DAILY_LIMIT_REACHED", "上限"));
		await expect(runConsultation({ ...params, role: "SE", input: "# 要件" })).rejects.toMatchObject({
			code: "DAILY_LIMIT_REACHED",
		});
	});
});

describe("runConsultation（priorQa）", () => {
	it("SE 工程の相談結果を質問作成と回答の両方に渡す", async () => {
		const { deps, answerCalls, params } = setup([{ to: "SE", question: "Q" }]);
		const priorQa = [{ question: "カテゴリは？", answer: "固定リスト" }];
		await runConsultation({ ...params, role: "PG", input: "# 設計", design: "# 設計", priorQa });
		expect(deps.postConsult).toHaveBeenCalledWith("PG", "# 設計", priorQa, undefined);
		expect(answerCalls[0]?.priorQa).toEqual(priorQa);
	});
});
