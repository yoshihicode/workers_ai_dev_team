import { bindings, defineConfig } from "cf/config";
import * as entrypoint from "./worker/index.ts" with { type: "cf-worker" };

export default defineConfig({
	worker: {
		name: "workers-ai-dev-team-web",
		compatibilityDate: "2026-11-13",
		entrypoint,
		assets: {
			notFoundHandling: "single-page-application",
			// /api/* は静的ファイルより先に Worker で処理し、api Worker に転送する
			runWorkerFirst: ["/api/*"],
		},
		env: {
			// api Worker への Service Binding。
			// api の設定ファイルを import すると api 側のソースが web の型環境で型チェックされてしまうため、Worker 名で指定する。
			API: bindings.worker({ worker: "workers-ai-dev-team-api" }),
		},
	},
});
