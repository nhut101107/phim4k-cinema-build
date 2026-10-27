#!/usr/bin/env node
/**
 * Phim4K Cinema 4-Tier E2E Test Suite Standalone Runner
 * Executes and reports across:
 * - Tier 1: Feature Coverage (F1-F6)
 * - Tier 2: Boundary & Corner Cases
 * - Tier 3: Cross-Feature Combinations
 * - Tier 4: Real-World Application Scenarios
 */

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const SUITE_DIR = __dirname;
const PROJECT_ROOT = path.resolve(SUITE_DIR, '..', '..');

// Terminal colors
const colors = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  bgBlue: '\x1b[44m',
  bgGreen: '\x1b[42m',
  bgRed: '\x1b[41m'
};

const TIERS = [
  {
    id: 1,
    name: 'Tier 1: Feature Coverage (F1–F6)',
    files: [
      { file: 'tier1-downloads.test.js', feature: 'F1: Download links format & endpoints' },
      { file: 'tier1-next-episode.test.js', feature: 'F2: Next Episode auto-play countdown' },
      { file: 'tier1-skip-intro.test.js', feature: 'F3: "Bỏ qua Intro" (Skip Intro ~85s)' },
      { file: 'tier1-failover.test.js', feature: 'F4: Auto-failover to backup stream servers' },
      { file: 'tier1-live-search.test.js', feature: 'F5: Live search autocomplete & poster preview' },
      { file: 'tier1-related-movies.test.js', feature: 'F6: Related movies section in detail modal' }
    ]
  },
  {
    id: 2,
    name: 'Tier 2: Boundary & Corner Cases',
    files: [
      { file: 'tier2-boundary-corner.test.js', feature: 'Corner cases across F1–F6 (30 boundary tests)' }
    ]
  },
  {
    id: 3,
    name: 'Tier 3: Cross-Feature Combinations',
    files: [
      { file: 'tier3-cross-feature.test.js', feature: 'Cross-feature multi-step user workflows' }
    ]
  },
  {
    id: 4,
    name: 'Tier 4: Real-World Application Scenarios',
    files: [
      { file: 'tier4-real-world.test.js', feature: 'Realistic end-to-end streaming journeys' }
    ]
  }
];

function parseTapOutput(rawOutput) {
  const tests = [];
  const lines = rawOutput.split('\n');
  let currentTest = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('ok ') || trimmed.startsWith('not ok ')) {
      const isOk = trimmed.startsWith('ok ');
      const isSkipped = trimmed.includes('# SKIP') || trimmed.includes('# skip');
      const parts = trimmed.split('-');
      const name = parts.slice(1).join('-').replace(/#\s*(SKIP|skip).*/, '').trim();

      const testResult = {
        name: name || 'Unnamed test',
        passed: isOk && !isSkipped,
        skipped: isSkipped,
        failed: !isOk
      };
      tests.push(testResult);
      currentTest = testResult;
    }
  }

  return tests;
}

function runTestFile(fileName) {
  const filePath = path.join(SUITE_DIR, fileName);
  const start = performance.now();

  const child = spawnSync(process.execPath, ['--test', '--test-reporter=tap', filePath], {
    cwd: PROJECT_ROOT,
    env: { ...process.env, NODE_ENV: 'test' },
    encoding: 'utf8'
  });

  const durationMs = Math.round(performance.now() - start);
  const tapTests = parseTapOutput(child.stdout || '');

  return {
    exitCode: child.status,
    stdout: child.stdout,
    stderr: child.stderr,
    tests: tapTests,
    durationMs
  };
}

function main() {
  const args = process.argv.slice(2);
  const filterTierArg = args.find(a => a.startsWith('--tier='));
  const targetTier = filterTierArg ? parseInt(filterTierArg.split('=')[1], 10) : null;
  const verbose = args.includes('--verbose') || args.includes('-v');
  const jsonMode = args.includes('--json');

  const startTime = Date.now();

  if (!jsonMode) {
    console.log(`\n${colors.bold}${colors.cyan}======================================================================${colors.reset}`);
    console.log(`${colors.bold}${colors.white}   PHIM4K CINEMA — 4-TIER OPAQUE-BOX E2E TEST SUITE RUNNER${colors.reset}`);
    console.log(`${colors.cyan}======================================================================${colors.reset}`);
    console.log(`${colors.dim}Node: ${process.version} | Platform: ${process.platform} | Time: ${new Date().toISOString()}${colors.reset}\n`);
  }

  let totalTests = 0;
  let totalPassed = 0;
  let totalSkipped = 0;
  let totalFailed = 0;
  const tierReports = [];

  const tiersToRun = targetTier ? TIERS.filter(t => t.id === targetTier) : TIERS;

  for (const tier of tiersToRun) {
    if (!jsonMode) {
      console.log(`${colors.bold}${colors.blue}▶ [Tier ${tier.id}] ${tier.name}${colors.reset}`);
    }

    const tierReport = {
      id: tier.id,
      name: tier.name,
      files: [],
      passed: 0,
      skipped: 0,
      failed: 0,
      total: 0,
      durationMs: 0
    };

    for (const item of tier.files) {
      const res = runTestFile(item.file);
      const passed = res.tests.filter(t => t.passed).length;
      const skipped = res.tests.filter(t => t.skipped).length;
      const failed = res.tests.filter(t => t.failed).length || (res.exitCode !== 0 && passed === 0 ? 1 : 0);
      const total = passed + skipped + failed;

      tierReport.passed += passed;
      tierReport.skipped += skipped;
      tierReport.failed += failed;
      tierReport.total += total;
      tierReport.durationMs += res.durationMs;

      totalPassed += passed;
      totalSkipped += skipped;
      totalFailed += failed;
      totalTests += total;

      tierReport.files.push({
        file: item.file,
        feature: item.feature,
        total,
        passed,
        skipped,
        failed,
        durationMs: res.durationMs,
        tests: res.tests
      });

      if (!jsonMode) {
        const statusBadge = failed > 0
          ? `${colors.red}✖ FAIL${colors.reset}`
          : skipped > 0 && passed === 0
            ? `${colors.yellow}﹣ SKIP${colors.reset}`
            : `${colors.green}✔ PASS${colors.reset}`;

        console.log(`   ${statusBadge} ${colors.bold}${item.feature}${colors.reset}`);
        console.log(`      ${colors.dim}Suite:${colors.reset} ${item.file} | ${colors.green}${passed} passed${colors.reset}, ${colors.yellow}${skipped} skipped${colors.reset}, ${failed ? colors.red : colors.dim}${failed} failed${colors.reset} (${res.durationMs}ms)`);

        if (verbose || failed > 0) {
          for (const t of res.tests) {
            const icon = t.failed ? `${colors.red}✖${colors.reset}` : t.skipped ? `${colors.yellow}﹣${colors.reset}` : `${colors.green}✔${colors.reset}`;
            console.log(`        ${icon} ${colors.dim}${t.name}${colors.reset}`);
          }
        }
      }
    }

    tierReports.push(tierReport);
    if (!jsonMode) console.log('');
  }

  const totalDurationMs = Date.now() - startTime;

  if (jsonMode) {
    console.log(JSON.stringify({
      summary: { totalTests, totalPassed, totalSkipped, totalFailed, totalDurationMs, success: totalFailed === 0 },
      tiers: tierReports
    }, null, 2));
    process.exit(totalFailed === 0 ? 0 : 1);
  }

  // Summary Table
  console.log(`${colors.bold}${colors.cyan}----------------------------------------------------------------------${colors.reset}`);
  console.log(`${colors.bold}${colors.white}   TEST SUITE EXECUTION SUMMARY${colors.reset}`);
  console.log(`${colors.cyan}----------------------------------------------------------------------${colors.reset}`);

  for (const tr of tierReports) {
    const tierStatus = tr.failed === 0 ? `${colors.green}PASSED${colors.reset}` : `${colors.red}FAILED${colors.reset}`;
    console.log(`   [Tier ${tr.id}] ${tr.name.padEnd(42)} ${tierStatus} | ${tr.passed}/${tr.total} (${tr.durationMs}ms)`);
  }

  console.log(`${colors.cyan}----------------------------------------------------------------------${colors.reset}`);
  console.log(`   Total Tests:    ${colors.bold}${totalTests}${colors.reset}`);
  console.log(`   Passed:         ${colors.green}${colors.bold}${totalPassed}${colors.reset}`);
  console.log(`   Skipped:        ${totalSkipped > 0 ? colors.yellow : colors.dim}${totalSkipped}${colors.reset}`);
  console.log(`   Failed:         ${totalFailed > 0 ? colors.red + colors.bold : colors.dim}${totalFailed}${colors.reset}`);
  console.log(`   Total Duration: ${totalDurationMs} ms (${(totalDurationMs / 1000).toFixed(2)}s)`);

  if (totalFailed === 0) {
    console.log(`\n${colors.bold}${colors.green}======================================================================${colors.reset}`);
    console.log(`${colors.bold}${colors.green}   ✔ ALL 4 TIERS EXECUTED SUCCESSFULLY — ZERO FAILURES${colors.reset}`);
    console.log(`${colors.bold}${colors.green}======================================================================${colors.reset}\n`);
    process.exit(0);
  } else {
    console.log(`\n${colors.bold}${colors.red}======================================================================${colors.reset}`);
    console.log(`${colors.bold}${colors.red}   ✖ ${totalFailed} TEST(S) FAILED IN E2E SUITE${colors.reset}`);
    console.log(`${colors.bold}${colors.red}======================================================================${colors.reset}\n`);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = { runTestFile, TIERS };
