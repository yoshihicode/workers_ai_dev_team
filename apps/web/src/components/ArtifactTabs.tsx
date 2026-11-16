import { useEffect, useRef } from "react";
import { downloadMarkdown } from "../lib/download.ts";

export type ArtifactKey = "requirements" | "consultation" | "design" | "code";
export type Artifacts = Record<ArtifactKey, string>;

const TABS: { key: ArtifactKey; label: string; filename: string }[] = [
	{ key: "requirements", label: "要件定義書", filename: "requirements.md" },
	{ key: "consultation", label: "相談記録", filename: "consultation.md" },
	{ key: "design", label: "設計書", filename: "design.md" },
	{ key: "code", label: "ソースコード", filename: "source-code.md" },
];

interface Props {
	artifacts: Artifacts;
	active: ArtifactKey;
	/** 作成中の成果物 */
	live: ArtifactKey[];
	allDone: boolean;
	onSelect: (key: ArtifactKey) => void;
}

export function ArtifactTabs({ artifacts, active, live, allDone, onSelect }: Props) {
	const previewRef = useRef<HTMLPreElement>(null);
	const content = artifacts[active];
	const current = TABS.find((tab) => tab.key === active) ?? TABS[0]!;
	const activeIsLive = live.includes(active);

	// 作成中は末尾に追従する
	useEffect(() => {
		if (activeIsLive && previewRef.current) {
			previewRef.current.scrollTop = previewRef.current.scrollHeight;
		}
	}, [content, activeIsLive]);

	return (
		<section className="panel artifacts" aria-label="成果物">
			<div className="tabs" role="tablist">
				{TABS.map((tab) => (
					<button
						key={tab.key}
						type="button"
						role="tab"
						aria-selected={tab.key === active}
						className={`tab ${tab.key === active ? "tab--active" : ""}`}
						onClick={() => onSelect(tab.key)}
					>
						{tab.label}
						{live.includes(tab.key) && <span className="tab__live" aria-label="作成中" />}
						{!live.includes(tab.key) && artifacts[tab.key] && <span className="tab__check">✓</span>}
					</button>
				))}
			</div>

			<pre ref={previewRef} className="preview" role="tabpanel">
				{content || <span className="preview__empty">まだ作成されていません。</span>}
				{activeIsLive && active !== "consultation" && <span className="caret" aria-hidden="true" />}
			</pre>

			<div className="artifacts__actions">
				<button
					type="button"
					className="button"
					disabled={!content || activeIsLive}
					onClick={() => downloadMarkdown(current.filename, content)}
				>
					{current.label}をダウンロード（.md）
				</button>
				{allDone && (
					<button
						type="button"
						className="button button--primary"
						onClick={() =>
							TABS.filter((tab) => artifacts[tab.key]).forEach((tab) => downloadMarkdown(tab.filename, artifacts[tab.key]))
						}
					>
						すべてダウンロード
					</button>
				)}
			</div>
		</section>
	);
}
