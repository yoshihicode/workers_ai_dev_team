import type { ActorView } from "../lib/workflow.ts";

const STATE_LABEL = {
	idle: "待機",
	active: "稼働中",
	done: "完了",
	error: "エラー",
	rejected: "対象外",
} as const;

export function StatusBoard({ actors }: { actors: ActorView[] }) {
	return (
		<section className="status-board" aria-label="エージェントの状態">
			{actors.map((actor) => (
				<div key={actor.id} className={`actor actor--${actor.state}`} aria-live="polite">
					<div className="actor__head">
						<span className="actor__name">{actor.title}</span>
						<span className="actor__badge">{STATE_LABEL[actor.state]}</span>
					</div>
					<p className="actor__detail">{actor.detail}</p>
				</div>
			))}
		</section>
	);
}
