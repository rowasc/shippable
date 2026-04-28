import { useEffect, useMemo, useState } from "react";
import { planReview } from "./plan";
import type { ChangeSet, ReviewPlan } from "./types";

export type PlanStatus = "loading" | "ready" | "fallback";

export interface UsePlanResult {
  plan: ReviewPlan;
  status: PlanStatus;
  error?: string;
}

/**
 * Fetches the AI-generated plan from /api/plan. While the request is in flight
 * we show the rule-based plan with status="loading". If the request fails we
 * stay on the rule-based plan with status="fallback" and surface the error.
 */
export function usePlan(cs: ChangeSet): UsePlanResult {
  const rulePlan = useMemo(() => planReview(cs), [cs]);
  const [aiPlan, setAiPlan] = useState<ReviewPlan | null>(null);
  const [status, setStatus] = useState<PlanStatus>("loading");
  const [error, setError] = useState<string | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    setAiPlan(null);
    setStatus("loading");
    setError(undefined);

    fetch("/api/plan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ changeset: cs }),
    })
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.text();
          throw new Error(`HTTP ${res.status}: ${body}`);
        }
        return res.json() as Promise<{ plan: ReviewPlan }>;
      })
      .then((body) => {
        if (cancelled) return;
        setAiPlan(body.plan);
        setStatus("ready");
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        console.warn("[usePlan] falling back to rule-based plan:", err);
        setError(err instanceof Error ? err.message : String(err));
        setStatus("fallback");
      });

    return () => {
      cancelled = true;
    };
  }, [cs]);

  return { plan: aiPlan ?? rulePlan, status, error };
}
