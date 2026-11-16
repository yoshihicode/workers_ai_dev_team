/** 相談記録（CLAUDE.md 6.5）の保持と Markdown への変換 */
import type { AgentRole, ConsultTarget } from "@workers-ai-dev-team/api/types";

export interface ConsultationEntry {
	to: ConsultTarget;
	question: string;
	/** 回答待ちの間は null */
	answer: string | null;
}

export interface ConsultationRound {
	/** 質問した役割 */
	from: AgentRole;
	/** consulting: 質問を作成中 / answering: 回答待ち / done: 完了 / skipped: 相談を省略 */
	status: "consulting" | "answering" | "done" | "skipped";
	entries: ConsultationEntry[];
	/** skipped のときの理由など */
	note?: string;
}

const ROUND_TITLE: Record<AgentRole, string> = {
	SE: "SE から PM への相談（設計前）",
	PG: "PG から SE・PM への相談（実装前）",
};

export function consultationMarkdown(rounds: ConsultationRound[]): string {
	if (rounds.length === 0) return "";
	const sections = rounds.map((round) => {
		const lines = [`## ${ROUND_TITLE[round.from]}`, ""];
		if (round.status === "consulting") {
			lines.push("確認事項を整理しています…");
		} else if (round.status === "skipped") {
			lines.push(round.note ?? "相談せずに進めました。");
		} else if (round.entries.length === 0) {
			lines.push("確認事項はありませんでした。");
		} else {
			round.entries.forEach((entry, i) => {
				lines.push(`### 質問${i + 1}（${round.from} → ${entry.to}）`, entry.question, "");
				lines.push(`**${entry.to} の回答**: ${entry.answer ?? "回答を待っています…"}`, "");
			});
		}
		return lines.join("\n").trimEnd();
	});
	return ["# 相談記録", "", ...sections.flatMap((s) => [s, ""])].join("\n").trimEnd() + "\n";
}
