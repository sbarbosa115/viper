#!/usr/bin/env bash
# Waits for a Kubernetes Job to succeed or fail, prints its logs, and exits non-zero on failure.
# Usage: wait-job.sh <namespace> <job> <timeout-seconds>
set -uo pipefail
ns=$1 job=$2 timeout=$3
deadline=$((SECONDS + timeout))
while :; do
  # Conditions, not counters: a failed attempt that will be retried doesn't end the wait.
  ok=$(kubectl -n "$ns" get job "$job" -o jsonpath='{.status.conditions[?(@.type=="Complete")].status}' 2>/dev/null)
  bad=$(kubectl -n "$ns" get job "$job" -o jsonpath='{.status.conditions[?(@.type=="Failed")].status}' 2>/dev/null)
  if [ "$ok" = True ]; then result=0; break; fi
  if [ "$bad" = True ]; then result=1; break; fi
  if [ "$SECONDS" -ge "$deadline" ]; then echo "::error::job $job timed out after ${timeout}s"; result=1; break; fi
  sleep 5
done
kubectl -n "$ns" logs "job/$job" --all-containers --tail=200 || true
[ "$result" = 0 ] && echo "job $job succeeded" || echo "::error::job $job failed"
exit "$result"
