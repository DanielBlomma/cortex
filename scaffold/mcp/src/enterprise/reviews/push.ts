import { recordReviewDeliveryStatus } from "./trust-state.js";

export type ReviewPushItem = {
  policy_id: string;
  pass: boolean;
  severity: "error" | "warning" | "info";
  message: string;
  detail?: string;
  reviewed_at: string;
};

export type ReviewPushContext = {
  repo?: string;
  instance_id?: string;
  session_id?: string;
  context_dir?: string;
  project_root?: string;
};

export type ReviewPushResult = {
  success: boolean;
  count: number;
  error?: string;
  attempted?: boolean;
  delivery_status?: "accepted" | "failed";
};

const pending: ReviewPushItem[] = [];
let activeContext: ReviewPushContext = {};

export function setReviewPushContext(context: ReviewPushContext): void {
  activeContext = { ...context };
}

export function getReviewPushContext(): ReviewPushContext {
  return { ...activeContext };
}

export function queueReviewResult(item: ReviewPushItem): void {
  pending.push(item);
}

export function pendingCount(): number {
  return pending.length;
}

export async function pushReviewResults(
  baseUrl: string,
  apiKey: string,
): Promise<ReviewPushResult> {
  if (pending.length === 0) {
    return { success: true, count: 0, attempted: false };
  }

  const reviewsUrl = `${baseUrl.replace(/\/$/, "")}/api/v1/reviews/push`;
  const batch = pending.splice(0, 100);
  const attemptedAt = new Date().toISOString();
  if (activeContext.context_dir) {
    recordReviewDeliveryStatus(activeContext.context_dir, "pushed", {
      reviewCount: batch.length,
      attemptedAt,
    });
  }

  try {
    const response = await fetch(reviewsUrl, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "Accept": "application/json",
      },
      body: JSON.stringify({
        repo: activeContext.repo,
        instance_id: activeContext.instance_id,
        session_id: activeContext.session_id,
        reviews: batch,
      }),
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      pending.unshift(...batch);
      if (activeContext.context_dir) {
        recordReviewDeliveryStatus(activeContext.context_dir, "failed", {
          reviewCount: batch.length,
          attemptedAt,
          error: `HTTP ${response.status}`,
        });
      }
      return {
        success: false,
        count: 0,
        error: `HTTP ${response.status}`,
        attempted: true,
        delivery_status: "failed",
      };
    }

    if (activeContext.context_dir) {
      recordReviewDeliveryStatus(activeContext.context_dir, "accepted", {
        reviewCount: batch.length,
        attemptedAt,
      });
    }
    return {
      success: true,
      count: batch.length,
      attempted: true,
      delivery_status: "accepted",
    };
  } catch (err) {
    pending.unshift(...batch);
    const error = err instanceof Error ? err.message : "unknown error";
    if (activeContext.context_dir) {
      recordReviewDeliveryStatus(activeContext.context_dir, "failed", {
        reviewCount: batch.length,
        attemptedAt,
        error,
      });
    }
    return {
      success: false,
      count: 0,
      error,
      attempted: true,
      delivery_status: "failed",
    };
  }
}
