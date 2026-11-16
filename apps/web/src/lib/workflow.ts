/** 画面全体の進行状態と、各アクターの表示状態の算出 */

export type Phase = "hearing" | "designing" | "implementing" | "done";

/** SE / PG の工程内の段階（CLAUDE.md 6.5） */
export type Step = "consult" | "answer" | "work";

export type ActorId = "PM" | "SE" | "PG";
export type ActorState = "idle" | "active" | "done" | "error" | "rejected";

export interface ActorView {
	id: ActorId;
	title: string;
	state: ActorState;
	detail: string;
}

export interface WorkflowSnapshot {
	phase: Phase;
	/** PM の返答待ちかどうか（ヒアリング中） */
	pmBusy: boolean;
	/** エラーが起きた工程（なければ null） */
	failedAt: ActorId | null;
	/** PM が直前の依頼を対象外と判断したかどうか */
	rejected: boolean;
	/** SE / PG の工程内の段階（工程外は null） */
	step: Step | null;
	/** 相談に回答中のアクター */
	answering: ActorId[];
}

const TITLES: Record<ActorId, string> = { PM: "PM（要件定義）", SE: "SE（設計）", PG: "PG（実装）" };

const STEP_DETAIL: Record<"SE" | "PG", Record<Step, string>> = {
	SE: {
		consult: "設計前に PM への確認事項を整理しています…",
		answer: "PM の回答を待っています…",
		work: "基本設計書・詳細設計書を作成しています…",
	},
	PG: {
		consult: "実装前に SE・PM への確認事項を整理しています…",
		answer: "SE・PM の回答を待っています…",
		work: "ソースコードを書いています…",
	},
};

export function actorViews(s: WorkflowSnapshot): ActorView[] {
	const view = (id: ActorId, state: ActorState, detail: string): ActorView => ({ id, title: TITLES[id], state, detail });
	const asker = s.phase === "designing" ? "SE" : "PG";

	const pm = (): ActorView => {
		if (s.failedAt === "PM") return view("PM", "error", "エラーで停止しました");
		if (s.phase === "hearing") {
			if (s.pmBusy) return view("PM", "active", "回答を読んで要件を整理しています…");
			if (s.rejected) return view("PM", "rejected", "対象外の依頼です。規模を小さくして相談できます");
			return view("PM", "active", "あなたの回答を待っています");
		}
		if (s.answering.includes("PM")) return view("PM", "active", `${asker} からの質問に回答しています…`);
		return view("PM", "done", "要件定義書を作成しました");
	};

	const se = (): ActorView => {
		if (s.failedAt === "SE") return view("SE", "error", "エラーで停止しました");
		if (s.phase === "hearing") return view("SE", "idle", "要件定義の完了を待っています");
		if (s.phase === "designing") return view("SE", "active", STEP_DETAIL.SE[s.step ?? "work"]);
		if (s.answering.includes("SE")) return view("SE", "active", "PG からの質問に回答しています…");
		return view("SE", "done", "設計書を作成しました");
	};

	const pg = (): ActorView => {
		if (s.failedAt === "PG") return view("PG", "error", "エラーで停止しました");
		if (s.phase === "hearing" || s.phase === "designing") return view("PG", "idle", "設計の完了を待っています");
		if (s.phase === "implementing") return view("PG", "active", STEP_DETAIL.PG[s.step ?? "work"]);
		return view("PG", "done", "ソースコードを作成しました");
	};

	return [pm(), se(), pg()];
}
