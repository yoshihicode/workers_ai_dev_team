import { cloudflare } from "@cloudflare/vite-plugin";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
	plugins: [react(), cloudflare({ inspectorPort: 9229 })],
	server: {
		// api（5174）と重ならないポートにする
		port: 5173,
		strictPort: true,
	},
});
