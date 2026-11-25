// npm run zoho:check — proves the .env credentials work and every metric builds from live Zoho Books.
// Prints counts and errors only, never credential values.
import { getPanel, getTiles, source, zohoStatus } from "../src/data.js";
import { METRIC_IDS } from "../src/metrics.js";
import { pickChart } from "../src/spec.js";

console.log(await zohoStatus().catch((e: Error) => `Zoho: ${e.message}`));
if (source !== "zoho_books") process.exit(0);

let failed = 0;
for (const id of METRIC_IDS) {
  try {
    const p = await getPanel(id);
    const size = p.shape === "trend" || p.shape === "breakdown" || p.shape === "share" ? p.x.length : p.rows.length;
    console.log(`  ok   ${id.padEnd(22)} ${pickChart(p).padEnd(16)} ${size} points`);
  } catch (e) {
    failed++;
    console.log(`  FAIL ${id.padEnd(22)} ${(e as Error).message}`);
  }
}
try {
  console.log(`  ok   tiles                  ${(await getTiles()).length} tiles`);
} catch (e) {
  failed++;
  console.log(`  FAIL tiles                  ${(e as Error).message}`);
}
process.exit(failed ? 1 : 0);
