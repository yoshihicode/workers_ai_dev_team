import type { ApiErrorCode, ApiErrorResponse } from "./types.ts";

export function errorResponse(status: number, code: ApiErrorCode, message: string): Response {
	const body: ApiErrorResponse = { error: { code, message } };
	return Response.json(body, { status });
}

export const DAILY_LIMIT_MESSAGE =
	"本日の利用上限に達しました。UTC 0時（日本時間 9時）以降に再度お試しください。";
