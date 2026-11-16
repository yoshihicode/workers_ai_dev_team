import { useMemo, useRef, useState } from "react";
import type {
	AgentRole,
	ChatMessage,
	ConsultTarget,
	QaItem,
	ReviewComment,
	ReviewerRole,
} from "@workers-ai-dev-team/api/types";
import { ArtifactTabs, type ArtifactKey, type Artifacts } from "./components/ArtifactTabs.tsx";
import { ChatPanel } from "./components/ChatPanel.tsx";
import { StatusBoard } from "./components/StatusBoard.tsx";
import { ApiError, postPmChat, streamAgentWork } from "./lib/api.ts";
import { consultationMarkdown, type ConsultationRound } from "./lib/consultation.ts";
import { runConsultation } from "./lib/pipeline.ts";
import { reviewMarkdown, runReviews, type FixStatus, type ReviewResult } from "./lib/review.ts";
import { actorViews, type ActorId, type Phase, type Step } from "./lib/workflow.ts";

/** AI が作る成果物（相談記録・レビュー記録は別の状態から組み立てる） */
type Documents = Pick<Artifacts, "requirements" | "design" | "code" | "codeBefore">;

const EMPTY_DOCUMENTS: Documents = { requirements: "", design: "", code: "", codeBefore: "" };

/** 途中から再開できる段階（SE → PG → レビュー → 作り直し） */
type Stage = "SE" | "PG" | "REVIEW" | "FIX";
const STAGES: Stage[] = ["SE", "PG", "REVIEW", "FIX"];

/** エラーで止まったときに再開する段階と、ボタンの文言 */
const RESUME: Partial<Record<Phase, { stage: Stage; label: string }>> = {
	designing: { stage: "SE", label: "SE（設計）から再試行" },
	implementing: { stage: "PG", label: "PG（実装）から再試行" },
	reviewing: { stage: "REVIEW", label: "レビューから再試行" },
	fixing: { stage: "FIX", label: "作り直しから再試行" },
};

interface PipelineContext {
	requirements: string;
	history: ChatMessage[];
	design?: string;
	/** レビュー対象（作り直し前）のソースコード */
	code?: string;
	/** 作り直しで反映する指摘 */
	comments?: ReviewComment[];
}

function errorMessage(error: unknown): string {
	if (error instanceof ApiError) return error.message;
	return "予期しないエラーが発生しました。";
}

/** 相談記録から、回答済みの確認事項を取り出す */
function qaFromRound(round: ConsultationRound | undefined): QaItem[] {
	if (!round || round.status !== "done") return [];
	return round.entries.flatMap((e) => (e.answer ? [{ question: e.question, answer: e.answer }] : []));
}

function isAbort(error: unknown): boolean {
	return error instanceof DOMException && error.name === "AbortError";
}

export function App() {
	const [phase, setPhase] = useState<Phase>("hearing");
	const [messages, setMessages] = useState<ChatMessage[]>([]);
	const [pmBusy, setPmBusy] = useState(false);
	const [documents, setDocuments] = useState<Documents>(EMPTY_DOCUMENTS);
	const [rounds, setRounds] = useState<ConsultationRound[]>([]);
	const [reviews, setReviews] = useState<ReviewResult[]>([]);
	const [fix, setFix] = useState<FixStatus>(null);
	const [reviewComments, setReviewComments] = useState<ReviewComment[]>([]);
	const [activeTab, setActiveTab] = useState<ArtifactKey>("requirements");
	const [streaming, setStreaming] = useState<ArtifactKey | null>(null);
	const [failed, setFailed] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [rejected, setRejected] = useState(false);
	const abortRef = useRef<AbortController | null>(null);

	// 現在の工程の相談状況から、工程内の段階と回答中のアクターを求める
	const currentRole: AgentRole | null = phase === "designing" ? "SE" : phase === "implementing" ? "PG" : null;
	const currentRound = rounds.find((r) => r.from === currentRole);
	const step: Step | null = !currentRole
		? null
		: !currentRound || currentRound.status === "consulting"
			? "consult"
			: currentRound.status === "answering"
				? "answer"
				: "work";
	const answering: ConsultTarget[] =
		currentRound?.status === "answering" ? [...new Set(currentRound.entries.map((e) => e.to))] : [];
	const reviewing: ReviewerRole[] =
		phase === "reviewing" ? reviews.filter((r) => r.status === "reviewing").map((r) => r.reviewer) : [];

	const actors = actorViews({
		phase,
		pmBusy,
		failed,
		rejected,
		step: failed ? null : step,
		answering: failed ? [] : (answering as ActorId[]),
		reviewing: failed ? [] : reviewing,
		fixed: fix === "done",
	});

	const artifacts: Artifacts = useMemo(
		() => ({ ...documents, consultation: consultationMarkdown(rounds), review: reviewMarkdown(reviews, fix) }),
		[documents, rounds, reviews, fix],
	);

	const live: ArtifactKey[] = failed
		? []
		: [
				...(streaming ? [streaming] : []),
				...(step === "consult" || step === "answer" ? (["consultation"] as const) : []),
				...(phase === "reviewing" ? (["review"] as const) : []),
			];

	const newSignal = () => {
		abortRef.current?.abort();
		abortRef.current = new AbortController();
		return abortRef.current.signal;
	};

	const upsertRound = (round: ConsultationRound) =>
		setRounds((prev) => [...prev.filter((r) => r.from !== round.from), round]);

	const upsertReview = (result: ReviewResult) =>
		setReviews((prev) => [...prev.filter((r) => r.reviewer !== result.reviewer), result]);

	/**
	 * SE → PG → レビュー → 作り直し を順に実行する（from で途中から再開できる）。
	 * SE / PG は作業の前に相談し、レビューで指摘があれば PG が1回だけ作り直す。
	 */
	const runPipeline = async (from: Stage, ctx: PipelineContext) => {
		const signal = newSignal();
		setError(null);
		setFailed(false);
		const start = STAGES.indexOf(from);
		const { requirements, history } = ctx;
		let design = ctx.design ?? "";
		let code = ctx.code ?? "";
		let comments = ctx.comments ?? [];
		let seQa = qaFromRound(rounds.find((r) => r.from === "SE"));
		let pgQa = qaFromRound(rounds.find((r) => r.from === "PG"));
		const appendTo = (key: "design" | "code") => (text: string) =>
			setDocuments((prev) => ({ ...prev, [key]: prev[key] + text }));

		try {
			if (start <= STAGES.indexOf("SE")) {
				setPhase("designing");
				setRounds([]);
				setDocuments((prev) => ({ ...prev, design: "", code: "", codeBefore: "" }));
				setActiveTab("consultation");
				seQa = await runConsultation({ role: "SE", input: requirements, requirements, messages: history, signal, onRound: upsertRound });
				setActiveTab("design");
				setStreaming("design");
				design = await streamAgentWork("SE", requirements, appendTo("design"), { qa: seQa, signal });
				setStreaming(null);
			}

			if (start <= STAGES.indexOf("PG")) {
				setPhase("implementing");
				setRounds((prev) => prev.filter((r) => r.from !== "PG"));
				setDocuments((prev) => ({ ...prev, code: "", codeBefore: "" }));
				setActiveTab("consultation");
				pgQa = await runConsultation({
					role: "PG",
					input: design,
					requirements,
					design,
					messages: history,
					priorQa: seQa,
					signal,
					onRound: upsertRound,
				});
				setActiveTab("code");
				setStreaming("code");
				// PG には SE 工程と PG 工程の両方の確認事項を渡す
				code = await streamAgentWork("PG", design, appendTo("code"), { qa: [...seQa, ...pgQa], signal });
				setStreaming(null);
			}

			if (start <= STAGES.indexOf("REVIEW")) {
				setPhase("reviewing");
				setReviews([]);
				setFix(null);
				setDocuments((prev) => ({ ...prev, codeBefore: "" }));
				setActiveTab("review");
				comments = await runReviews({
					code,
					requirements,
					design,
					messages: history,
					qa: [...seQa, ...pgQa],
					signal,
					onResult: upsertReview,
				});
				setReviewComments(comments);
				if (comments.length === 0) {
					setFix("none");
					setPhase("done");
					return;
				}
			}

			// 作り直し（1回だけ）。修正前のコードは比較できるよう残す
			setPhase("fixing");
			setFix("fixing");
			setDocuments((prev) => ({ ...prev, codeBefore: code, code: "" }));
			setActiveTab("code");
			setStreaming("code");
			await streamAgentWork("PG", design, appendTo("code"), {
				qa: [...seQa, ...pgQa],
				review: { previousCode: code, comments },
				signal,
			});
			setFix("done");
			setPhase("done");
		} catch (e) {
			if (isAbort(e)) return;
			setFailed(true);
			setError(errorMessage(e));
		} finally {
			setStreaming(null);
		}
	};

	const sendMessage = async (text: string) => {
		const next: ChatMessage[] = [...messages, { role: "user", content: text }];
		setMessages(next);
		setPmBusy(true);
		setError(null);
		setFailed(false);
		setRejected(false);
		try {
			const result = await postPmChat(next, newSignal());
			const history: ChatMessage[] = [...next, { role: "assistant", content: result.message }];
			setMessages(history);
			// 対象外の依頼: SE には進まず、規模を小さくして相談し直せるようチャットを続ける
			setRejected(result.status === "rejected");
			if (result.status === "completed" && result.requirements) {
				setDocuments({ ...EMPTY_DOCUMENTS, requirements: result.requirements });
				setReviews([]);
				setFix(null);
				setPmBusy(false);
				void runPipeline("SE", { requirements: result.requirements, history });
				return;
			}
		} catch (e) {
			if (isAbort(e)) return;
			// 送信に失敗したメッセージは入力し直せるよう履歴から外す
			setMessages(messages);
			setFailed(true);
			setError(errorMessage(e));
		}
		setPmBusy(false);
	};

	const resume = RESUME[phase];

	const retry = () => {
		if (!resume) {
			setError(null);
			setFailed(false);
			return;
		}
		void runPipeline(resume.stage, {
			requirements: documents.requirements,
			history: messages,
			design: documents.design,
			// 作り直しの再試行では、修正前（レビュー対象）のコードを使う
			code: resume.stage === "FIX" ? documents.codeBefore : documents.code,
			comments: reviewComments,
		});
	};

	const reset = () => {
		abortRef.current?.abort();
		setPhase("hearing");
		setMessages([]);
		setPmBusy(false);
		setDocuments(EMPTY_DOCUMENTS);
		setRounds([]);
		setReviews([]);
		setFix(null);
		setReviewComments([]);
		setActiveTab("requirements");
		setStreaming(null);
		setFailed(false);
		setError(null);
		setRejected(false);
	};

	return (
		<div className="app">
			<header className="app__header">
				<div>
					<h1 className="app__title">AI開発チーム</h1>
					<p className="app__lead">
						PM・SE・PG の AI が相談・レビューしながら、要件定義書・設計書・ソースコードを順番に作成します。
					</p>
				</div>
				<button type="button" className="button" onClick={reset}>
					最初からやり直す
				</button>
			</header>

			<StatusBoard actors={actors} />

			{error && (
				<div className="alert" role="alert">
					<p>{error}</p>
					<button type="button" className="button" onClick={retry}>
						{resume ? resume.label : "閉じる"}
					</button>
				</div>
			)}

			{rejected && !pmBusy && (
				<div className="notice" role="status">
					<p>
						この依頼は規模が大きいため作成できません（対象外）。PM の提案を参考に機能を絞って入力し直すか、「最初からやり直す」で別のアプリを相談してください。
					</p>
				</div>
			)}

			<main className="app__main">
				<ChatPanel messages={messages} busy={pmBusy} disabled={phase !== "hearing"} onSend={(text) => void sendMessage(text)} />
				<ArtifactTabs
					artifacts={artifacts}
					active={activeTab}
					live={live}
					allDone={phase === "done"}
					onSelect={setActiveTab}
				/>
			</main>
		</div>
	);
}
