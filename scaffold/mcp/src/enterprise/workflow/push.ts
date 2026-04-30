import type { WorkflowState } from "./state.js";

export type WorkflowPushContext = {
  repo?: string;
  instance_id?: string;
  session_id?: string;
};

export type WorkflowPushResult = {
  success: boolean;
  status?: number;
  error?: string;
};

let activeContext: WorkflowPushContext = {};

export function setWorkflowPushContext(context: WorkflowPushContext): void {
  activeContext = { ...context };
}

export async function pushWorkflowSnapshot(
  endpoint: string,
  apiKey: string,
  workflow: WorkflowState
): Promise<WorkflowPushResult> {
  if (!endpoint || !apiKey) {
    return { success: false, error: "endpoint or api_key not configured" };
  }

  const workflowUrl = endpoint.replace(/\/policies\/sync\/?$/, "/workflow/push");

  try {
    const response = await fetch(workflowUrl, {
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
        workflow,
      }),
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      return { success: false, status: response.status, error: `HTTP ${response.status}` };
    }

    return { success: true, status: response.status };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "unknown error",
    };
  }
}
