import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import type { ChatMessage } from "@workers-ai-dev-team/api/types";
import { SUPPORTED_TARGETS, UNSUPPORTED_EXAMPLES } from "../lib/scope.ts";

interface Props {
	messages: ChatMessage[];
	busy: boolean;
	disabled: boolean;
	onSend: (text: string) => void;
}

export function ChatPanel({ messages, busy, disabled, onSend }: Props) {
	const [draft, setDraft] = useState("");
	const listRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
	}, [messages, busy]);

	const submit = (event?: FormEvent) => {
		event?.preventDefault();
		const text = draft.trim();
		if (!text || busy || disabled) return;
		onSend(text);
		setDraft("");
	};

	// Enter で送信、Shift+Enter で改行（日本語変換中の Enter は送信しない）
	const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
		if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
			event.preventDefault();
			submit();
		}
	};

	return (
		<section className="panel chat" aria-label="PMとのチャット">
			<h2 className="panel__title">PM とのヒアリング</h2>
			<div className="chat__list" ref={listRef}>
				{messages.length === 0 && (
					<div className="chat__empty">
						<p>作りたいアプリのイメージを入力してください。PM が要件を確認するための質問をします。</p>
						<p className="chat__scope-title">作成できるもの（小規模なもののみ）</p>
						<ul className="chat__scope">
							{SUPPORTED_TARGETS.map((target) => (
								<li key={target}>{target}</li>
							))}
						</ul>
						<p>{UNSUPPORTED_EXAMPLES}</p>
					</div>
				)}
				{messages.map((message, index) => (
					<div key={index} className={`bubble bubble--${message.role}`}>
						<span className="bubble__who">{message.role === "user" ? "あなた" : "PM"}</span>
						<p className="bubble__text">{message.content}</p>
					</div>
				))}
				{busy && (
					<div className="bubble bubble--assistant bubble--typing">
						<span className="bubble__who">PM</span>
						<p className="bubble__text">
							<span className="dots" aria-label="入力中">
								<span />
								<span />
								<span />
							</span>
						</p>
					</div>
				)}
			</div>
			<form className="chat__form" onSubmit={submit}>
				<textarea
					className="chat__input"
					value={draft}
					onChange={(event) => setDraft(event.target.value)}
					onKeyDown={onKeyDown}
					placeholder={disabled ? "ヒアリングは完了しました" : "例: 毎日の水分摂取量を記録するアプリを作りたい"}
					disabled={disabled}
					rows={3}
				/>
				<button type="submit" className="button button--primary" disabled={disabled || busy || draft.trim() === ""}>
					送信
				</button>
			</form>
		</section>
	);
}
