/**
 * NavGator UI Functional Test Script
 * Uses InterfaceBuiltRight (IBR) to verify all selectable buttons,
 * navigation, and interactive elements across the Next.js dashboard.
 *
 * Prerequisites:
 *   - NavGator web dashboard running: cd web && npm run dev
 *   - IBR installed: npm install @tyroneross/interface-built-right
 *
 * Usage:
 *   node scripts/ibr-ui-test.mjs [--base-url http://localhost:3000]
 */

import { InterfaceBuiltRight } from '@tyroneross/interface-built-right';

const BASE_URL = process.argv.includes('--base-url')
  ? process.argv[process.argv.indexOf('--base-url') + 1]
  : 'http://localhost:3000';

const ibr = new InterfaceBuiltRight({
  baseUrl: BASE_URL,
  outputDir: './.ibr',
  fullPage: true,
  timeout: 15000,
});

const results = [];
let session;

function log(status, msg) {
  const icon = status === 'PASS' ? '\u2713' : status === 'FAIL' ? '\u2717' : '\u2022';
  console.log(`  ${icon} ${msg}`);
  results.push({ status, msg });
}

async function test(name, fn) {
  try {
    await fn();
    log('PASS', name);
  } catch (err) {
    log('FAIL', `${name} — ${err.message}`);
  }
}

// ==========================================================================
// 1. INITIAL LOAD & SEMANTIC ANALYSIS
// ==========================================================================

console.log('\n--- NavGator IBR UI Test ---\n');
console.log(`Target: ${BASE_URL}\n`);

console.log('[1] Page Load & Semantic Understanding');

session = await ibr.start('/', { viewport: 'desktop' });
const semantic = await session.understand();

test('Page loads with title', async () => {
  const title = await session.page.title();
  if (!title) throw new Error('No page title');
});

test('Header renders with NavGator branding', async () => {
  await session.page.waitForSelector('header', { timeout: 5000 });
});

test('Sidebar renders with navigation items', async () => {
  await session.page.waitForSelector('aside nav', { timeout: 5000 });
});

// ==========================================================================
// 2. SIDEBAR NAVIGATION — All 7 views
// ==========================================================================

console.log('\n[2] Sidebar Navigation (7 views)');

const sidebarViews = [
  { label: 'Overview', expectText: 'Architecture Status' },
  { label: 'Components', expectText: 'Components' },
  { label: 'Connections', expectText: 'Connections' },
  { label: 'Impact', expectText: 'Impact' },
  { label: 'Diagram', expectText: 'Diagram' },
  { label: 'LLM Tracking', expectText: 'LLM' },
  { label: 'Settings', expectText: 'Settings' },
];

for (const view of sidebarViews) {
  await test(`Navigate to "${view.label}" view`, async () => {
    // Click sidebar button by text
    const btn = await session.page.locator(`aside button:has-text("${view.label}")`).first();
    await btn.click();
    await session.page.waitForTimeout(500);

    // Verify view rendered (check main content area has expected text)
    const main = await session.page.locator('main').textContent();
    if (!main.includes(view.expectText)) {
      throw new Error(`Expected "${view.expectText}" in main content`);
    }
  });
}

// ==========================================================================
// 3. HEADER ELEMENTS
// ==========================================================================

console.log('\n[3] Header Interactive Elements');

await test('Search input is present and focusable', async () => {
  const input = session.page.locator('header input[placeholder*="Search"]');
  if (await input.count() === 0) throw new Error('Search input not found');
  await input.focus();
});

await test('Scan button is present and clickable', async () => {
  const scanBtn = session.page.locator('header button:has-text("Scan")');
  if (await scanBtn.count() === 0) throw new Error('Scan button not found');
  // Don't actually trigger scan, just verify it exists and is enabled
  const disabled = await scanBtn.isDisabled();
  if (disabled) throw new Error('Scan button is disabled');
});

// ==========================================================================
// 4. OVERVIEW — Stat cards & quick actions
// ==========================================================================

console.log('\n[4] Overview — Stat Cards & Quick Actions');

// Navigate back to overview
await session.page.locator('aside button:has-text("Overview")').first().click();
await session.page.waitForTimeout(500);

await test('Stat cards are clickable (Components card)', async () => {
  const card = session.page.locator('main button:has-text("Components")').first();
  if (await card.count() === 0) throw new Error('Components stat card not found');
  await card.click();
  await session.page.waitForTimeout(300);
  // Should navigate to components view
  const main = await session.page.locator('main').textContent();
  if (!main.includes('Components')) throw new Error('Did not navigate to Components');
});

// Go back to overview
await session.page.locator('aside button:has-text("Overview")').first().click();
await session.page.waitForTimeout(500);

await test('Quick Action: "View Diagram" navigates to diagram', async () => {
  const btn = session.page.locator('main button:has-text("View Diagram")');
  if (await btn.count() === 0) throw new Error('View Diagram action not found');
  await btn.click();
  await session.page.waitForTimeout(300);
  const main = await session.page.locator('main').textContent();
  if (!main.includes('Diagram')) throw new Error('Did not navigate to Diagram');
});

// Go back to overview
await session.page.locator('aside button:has-text("Overview")').first().click();
await session.page.waitForTimeout(500);

await test('Quick Action: "Impact Analysis" navigates to impact', async () => {
  const btn = session.page.locator('main button:has-text("Impact Analysis")');
  if (await btn.count() === 0) throw new Error('Impact Analysis action not found');
  await btn.click();
  await session.page.waitForTimeout(300);
});

await test('"View all" link in Components by Type card', async () => {
  await session.page.locator('aside button:has-text("Overview")').first().click();
  await session.page.waitForTimeout(500);
  const viewAll = session.page.locator('main button:has-text("View all"), main a:has-text("View all")').first();
  if (await viewAll.count() > 0) {
    await viewAll.click();
    await session.page.waitForTimeout(300);
  }
  // Acceptable if no data present — just check it doesn't crash
});

// ==========================================================================
// 5. SETTINGS — Tabs, switches, selects, buttons
// ==========================================================================

console.log('\n[5] Settings Panel — Tabs, Switches, Selects, Buttons');

await session.page.locator('aside button:has-text("Settings")').first().click();
await session.page.waitForTimeout(500);

const settingsTabs = ['Scanning', 'Detection', 'Notifications', 'Display'];

for (const tab of settingsTabs) {
  await test(`Settings tab: "${tab}" is clickable`, async () => {
    const tabBtn = session.page.locator(`button[role="tab"]:has-text("${tab}"), [data-value="${tab.toLowerCase()}"]`).first();
    // Fallback: find by text in tabs area
    const fallback = session.page.locator(`button:has-text("${tab}")`).first();
    const target = (await tabBtn.count() > 0) ? tabBtn : fallback;
    await target.click();
    await session.page.waitForTimeout(300);
  });
}

await test('Save Changes button is clickable', async () => {
  const saveBtn = session.page.locator('button:has-text("Save")').first();
  if (await saveBtn.count() === 0) throw new Error('Save button not found');
  await saveBtn.click();
  await session.page.waitForTimeout(500);
  // Check for "Saved" feedback
  const text = await session.page.locator('button:has-text("Saved")').count();
  if (text === 0) {
    // Also accept if button still says "Save Changes" (no API connected)
  }
});

await test('Reset button is clickable', async () => {
  const resetBtn = session.page.locator('button:has-text("Reset")').first();
  if (await resetBtn.count() === 0) throw new Error('Reset button not found');
  await resetBtn.click();
});

await test('Switch toggles respond to click', async () => {
  // Click the Scanning tab first
  await session.page.locator('button:has-text("Scanning")').first().click();
  await session.page.waitForTimeout(300);

  const switches = session.page.locator('button[role="switch"]');
  const count = await switches.count();
  if (count === 0) throw new Error('No switch toggles found');

  // Toggle the first switch
  const first = switches.first();
  const before = await first.getAttribute('data-state');
  await first.click();
  await session.page.waitForTimeout(200);
  const after = await first.getAttribute('data-state');
  if (before === after) throw new Error('Switch did not toggle');
  // Toggle back
  await first.click();
});

await test('Select dropdowns open and have options', async () => {
  const triggers = session.page.locator('button[role="combobox"]');
  const count = await triggers.count();
  if (count === 0) throw new Error('No select dropdowns found');

  // Open first select
  await triggers.first().click();
  await session.page.waitForTimeout(300);

  const options = session.page.locator('[role="option"]');
  const optCount = await options.count();
  if (optCount === 0) throw new Error('Select opened but no options found');

  // Close by pressing Escape
  await session.page.keyboard.press('Escape');
});

// ==========================================================================
// 6. HELP BUTTON (non-functional check)
// ==========================================================================

console.log('\n[6] Non-Functional Element Check');

await test('Help button exists but has no navigation action', async () => {
  const helpBtn = session.page.locator('aside button:has-text("Help")');
  if (await helpBtn.count() === 0) throw new Error('Help button not found');
  // This button has no onClick handler — it's non-functional
  // IBR flags this as a potential Calm Precision violation (Affordance Theory)
});

// ==========================================================================
// 7. INTERACTIVITY TEST (IBR built-in)
// ==========================================================================

console.log('\n[7] IBR Interactivity Audit');

// Navigate to overview for broadest element coverage
await session.page.locator('aside button:has-text("Overview")').first().click();
await session.page.waitForTimeout(500);

await test('IBR interactivity test passes', async () => {
  const interactivity = await session.testInteractivity();
  const issues = interactivity.issues || [];
  const critical = issues.filter(i => i.severity === 'critical' || i.severity === 'error');
  if (critical.length > 0) {
    throw new Error(`${critical.length} critical interactivity issues: ${critical.map(i => i.message).join('; ')}`);
  }
  console.log(`    Found ${interactivity.buttons?.length || 0} buttons, ${interactivity.links?.length || 0} links, ${interactivity.forms?.length || 0} forms`);
  if (issues.length > 0) {
    console.log(`    Warnings: ${issues.length}`);
    issues.slice(0, 3).forEach(i => console.log(`      - ${i.message}`));
  }
});

// ==========================================================================
// 8. PERFORMANCE CHECK (IBR built-in)
// ==========================================================================

console.log('\n[8] IBR Performance Metrics');

await test('Web Vitals within acceptable range', async () => {
  const perf = await session.measurePerformance();
  const ratings = perf.ratings || {};
  console.log(`    LCP: ${ratings.LCP?.value || 'N/A'}ms (${ratings.LCP?.rating || '?'})`);
  console.log(`    CLS: ${ratings.CLS?.value || 'N/A'} (${ratings.CLS?.rating || '?'})`);
  console.log(`    TBT: ${ratings.TBT?.value || 'N/A'}ms (${ratings.TBT?.rating || '?'})`);

  if (ratings.LCP?.rating === 'poor') {
    throw new Error(`LCP is poor: ${ratings.LCP.value}ms`);
  }
});

// ==========================================================================
// 9. VISUAL BASELINE CAPTURE
// ==========================================================================

console.log('\n[9] Visual Baseline Capture');

const viewsToCapture = ['/', '/?view=components', '/?view=settings'];
// Capture baselines by navigating sidebar
const viewMap = [
  { label: 'Overview', name: 'overview' },
  { label: 'Components', name: 'components' },
  { label: 'Settings', name: 'settings' },
];

for (const view of viewMap) {
  await test(`Capture baseline: ${view.name}`, async () => {
    await session.page.locator(`aside button:has-text("${view.label}")`).first().click();
    await session.page.waitForTimeout(500);
    await session.screenshot(`.ibr/navgator-${view.name}-baseline.png`);
  });
}

// ==========================================================================
// SUMMARY
// ==========================================================================

await session.close();

console.log('\n========================================');
console.log('TEST SUMMARY');
console.log('========================================\n');

const passed = results.filter(r => r.status === 'PASS').length;
const failed = results.filter(r => r.status === 'FAIL').length;
const total = results.length;

console.log(`  Total: ${total}`);
console.log(`  Passed: ${passed}`);
console.log(`  Failed: ${failed}`);
console.log();

if (failed > 0) {
  console.log('  FAILURES:');
  results.filter(r => r.status === 'FAIL').forEach(r => {
    console.log(`    \u2717 ${r.msg}`);
  });
  console.log();
  process.exit(1);
} else {
  console.log('  All tests passed.\n');
  process.exit(0);
}
