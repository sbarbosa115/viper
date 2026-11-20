/** Waits until the stack answers on ${BASE_URL}/api/health. */
export default async function globalSetup(): Promise<void> {
  const baseUrl = process.env.BASE_URL ?? 'http://localhost:5173';
  const deadline = Date.now() + 120_000;
  let lastError = 'no response';
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${baseUrl}/api/health`);
      if (res.ok) return;
      lastError = `status ${res.status}`;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`${baseUrl}/api/health did not become healthy: ${lastError}`);
}
