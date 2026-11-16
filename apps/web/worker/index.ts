/** web Worker: /api/* を Service Binding 経由で api Worker に転送する */
export default {
	async fetch(request, env) {
		const url = new URL(request.url);
		if (url.pathname.startsWith("/api/")) {
			return env.API.fetch(request);
		}
		// runWorkerFirst が /api/* のみのため通常ここには来ない
		return new Response("Not Found", { status: 404 });
	},
} satisfies ExportedHandler<Env>;
