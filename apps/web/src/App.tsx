import { useMemo, useRef, useState } from "react";
import type { AgentRole, ChatMessage, ConsultTarget, QaItem } from "@workers-ai-dev-team/api/types";
import { ArtifactTabs, type ArtifactKey, type Artifacts } from "./components/ArtifactTabs.tsx";
import { ChatPanel } from "./components/ChatPanel.tsx";
import { StatusBoard } from "./components/StatusBoard.tsx";
import { ApiError, postPmChat, streamAgentWork } from "./lib/api.ts";
import { consultationMarkdown, type ConsultationRound } from "./lib/consultation.ts";
import { runConsultation } from "./lib/pipeline.ts";
import { actorViews, type ActorId, type Phase, type Step } from "./lib/workflow.ts";

/** AI が作る成果物（相談記録は rounds から組み立てる） */
type Documents = Omit<Artifacts, "consultation">;

const EMPTY_DOCUMENTS: Documents = { requirements: "", design: "", code: "" };

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
	const [activeTab, setActiveTab] = useState<ArtifactKey>("requirements");
	const [streaming, setStreaming] = useState<ArtifactKey | null>(null);
	const [failedAt, setFailedAt] = useState<ActorId | null>(null);
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
	const consultationLive = step === "consult" || step === "answer";

	const actors = actorViews({ phase, pmBusy, failedAt, rejected, step: failedAt ? null : step, answering });

	const artifacts: Artifacts = useMemo(
		() => ({ ...documents, consultation: consultationMarkdown(rounds) }),
		[documents, rounds],
	);

	const live: ArtifactKey[] = [
		...(streaming ? [streaming] : []),
		...(consultationLive && !failedAt ? (["consultation"] as const) : []),
	];

	const newSignal = () => {
		abortRef.current?.abort();
		abortRef.current = new AbortController();
		return abortRef.current.signal;
	};

	const upsertRound = (round: ConsultationRound) =>
		setRounds((prev) => [...prev.filter((r) => r.from !== round.from), round]);

	/**
	 * SE → PG を順に実行する（from で途中から再開できる）。
	 * 各工程の前に相談（質問 → 回答）を行い、回答を作業の入力に付ける。
	 */
	const runPipeline = async (
		requirements: string,
		from: AgentRole,
		history: ChatMessage[],
		existingDesign = "",
	) => {
		const signal = newSignal();
		setError(null);
		setFailedAt(null);
		let design = existingDesign;
		// SE 工程の相談結果（PG から再開する場合は記録から復元する）
		let seQa = qaFromRound(rounds.find((r) => r.from === "SE"));
		let failedStep: ActorId = from;
		try {
			if (from === "SE") {
				setPhase("designing");
				setRounds([]);
				setDocuments((prev) => ({ ...prev, design: "", code: "" }));
				setActiveTab("consultation");
				seQa = await runConsultation({ role: "SE", input: requirements, requirements, messages: history, signal, onRound: upsertRound });
				const qa = seQa;
				setActiveTab("design");
				setStreaming("design");
				design = await streamAgentWork(
					"SE",
					requirements,
					qa,
					(text) => setDocuments((prev) => ({ ...prev, design: prev.design + text })),
					signal,
				);
				setStreaming(null);
			}
			failedStep = "PG";
			setPhase("implementing");
			setRounds((prev) => prev.filter((r) => r.from !== "PG"));
			setDocuments((prev) => ({ ...prev, code: "" }));
			setActiveTab("consultation");
			const pgQa = await runConsultation({
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
			await streamAgentWork(
				"PG",
				design,
				[...seQa, ...pgQa],
				(text) => setDocuments((prev) => ({ ...prev, code: prev.code + text })),
				signal,
			);
			setPhase("done");
		} catch (e) {
			if (isAbort(e)) return;
			setFailedAt(failedStep);
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
		setFailedAt(null);
		setRejected(false);
		try {
			const result = await postPmChat(next, newSignal());
			const history: ChatMessage[] = [...next, { role: "assistant", content: result.message }];
			setMessages(history);
			// 対象外の依頼: SE には進まず、規模を小さくして相談し直せるようチャットを続ける
			setRejected(result.status === "rejected");
			if (result.status === "completed" && result.requirements) {
				setDocuments({ ...EMPTY_DOCUMENTS, requirements: result.requirements });
				setPmBusy(false);
				void runPipeline(result.requirements, "SE", history);
				return;
			}
		} catch (e) {
			if (isAbort(e)) return;
			// 送信に失敗したメッセージは入力し直せるよう履歴から外す
			setMessages(messages);
			setFailedAt("PM");
			setError(errorMessage(e));
		}
		setPmBusy(false);
	};

	const retry = () => {
		if (failedAt === "SE") void runPipeline(documents.requirements, "SE", messages);
		else if (failedAt === "PG") void runPipeline(documents.requirements, "PG", messages, documents.design);
		else {
			setError(null);
			setFailedAt(null);
		}
	};

	const reset = () => {
		abortRef.current?.abort();
		setPhase("hearing");
		setMessages([]);
		setPmBusy(false);
		setDocuments(EMPTY_DOCUMENTS);
		setRounds([]);
		setActiveTab("requirements");
		setStreaming(null);
		setFailedAt(null);
		setError(null);
		setRejected(false);
	};

	return (
		<div className="app">
			<header className="app__header">
				<div>
					<h1 className="app__title">AI開発チーム</h1>
					<p className="app__lead">
						PM・SE・PG の AI が相談しながら、要件定義書・設計書・ソースコードを順番に作成します。
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
					{(failedAt === "SE" || failedAt === "PG") && (
						<button type="button" className="button" onClick={retry}>
							{failedAt} から再試行
						</button>
					)}
					{failedAt === "PM" && (
						<button type="button" className="button" onClick={retry}>
							閉じる
						</button>
					)}
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
