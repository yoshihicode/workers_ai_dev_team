/**
 * Workers AI のストリーム（SSE）を少しずつ受け取り、生成テキストを取り出すパーサー。
 * 形式: `data: {"response":"..."}\n\n` を繰り返し、最後に `data: [DONE]`。
 */
export interface SseParser {
	/** 受信したテキストを渡すと、取り出せた生成テキストの断片を返す */
	push(chunk: string): string[];
	/** [DONE] を受け取ったかどうか */
	readonly done: boolean;
}

/**
 * Workers AI は、トークンが JSON として解釈できる文字列（例: "3", "[]", "true"）のとき、
 * response を文字列ではなく数値・配列・真偽値などで返すことがある（2026-11-16 に実機で確認）。
 * その場合は文字列に戻す。ただし "007" や "1.0" のような表記は元に戻せない。
 */
function toText(value: unknown): string | null {
	if (typeof value === "string") return value;
	if (typeof value === "number" || typeof value === "boolean" || value === null) return String(value);
	if (typeof value === "object") return JSON.stringify(value);
	return null;
}

function extractText(data: string): string | null {
	let parsed: unknown;
	try {
		parsed = JSON.parse(data);
	} catch {
		return null;
	}
	if (typeof parsed !== "object" || parsed === null) return null;
	const record = parsed as { response?: unknown; choices?: Array<{ delta?: { content?: unknown } }> };
	// OpenAI 互換形式の content は常に文字列のため、あれば優先する（Llama はこちらも返す）
	const content = record.choices?.[0]?.delta?.content;
	if (typeof content === "string") return content;
	if (!("response" in record)) return null;
	return toText(record.response);
}

export function createSseParser(): SseParser {
	let buffer = "";
	let done = false;

	return {
		get done() {
			return done;
		},
		push(chunk: string): string[] {
			buffer += chunk.replace(/\r\n/g, "\n");
			const texts: string[] = [];
			let index: number;
			while ((index = buffer.indexOf("\n\n")) !== -1) {
				const event = buffer.slice(0, index);
				buffer = buffer.slice(index + 2);
				const data = event
					.split("\n")
					.filter((line) => line.startsWith("data:"))
					.map((line) => line.slice(5).trimStart())
					.join("\n");
				if (data === "") continue;
				if (data === "[DONE]") {
					done = true;
					continue;
				}
				const text = extractText(data);
				if (text) texts.push(text);
			}
			return texts;
		},
	};
}
