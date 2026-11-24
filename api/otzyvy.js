import { GET as readReviews } from "../server/reviews-handler.js";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const revalidate = 0;

export function GET(request, context) {
  let configured = "";
  try {
    const value = process.env.BITRIX_WEBHOOK_URL;
    if (typeof value === "string") configured = value;
  } catch {
    configured = "";
  }
  return readReviews(request, context, configured);
}
