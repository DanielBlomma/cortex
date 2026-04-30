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
};

export type ReviewPushResult = {
  success: boolean;
  count: number;
  error?: string;
};

const pending: ReviewPushItem[] = [];
let activeContext: ReviewPushContext = {};

export function setReviewPushContext(context: ReviewPushContext): void {
  activeContext = { ...context };
}

export function queueReviewResult(item: ReviewPushItem): void {
  pending.push(item);
}

export function pendingCount(): number {
  return pending.length;
}

export async function pushReviewResults(
  endpoint: string,
  apiKey: string,
): Promise<ReviewPushResult> {
  if (pending.length === 0) {
    return { success: true, count: 0 };
  }

  const reviewsUrl = endpoint.replace(/\/policies\/sync\/?$/, "/reviews/push");
  const batch = pending.splice(0, 100);

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
      return { success: false, count: 0, error: `HTTP ${response.status}` };
    }

    return { success: true, count: batch.length };
  } catch (err) {
    pending.unshift(...batch);
    return {
      success: false,
      count: 0,
      error: err instanceof Error ? err.message : "unknown error",
    };
  }
}
