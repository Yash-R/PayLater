import { Octokit } from "@octokit/rest";

const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });
const [owner, repo] = process.env.GITHUB_REPOSITORY.split("/");

const MERGE_LABEL = process.env.MERGE_LABEL || "bug";
const REQUIRED_APPROVALS = parseInt(process.env.REQUIRED_APPROVALS || "2", 10);
const POLL_INTERVAL = parseInt(process.env.POLL_INTERVAL_SECONDS || "20", 10);
const POLL_TIMEOUT = parseInt(process.env.POLL_TIMEOUT_SECONDS || "900", 10);

const sleep = (s) => new Promise((r) => setTimeout(r, s * 1000));

let hadFailure = false;

/**
 * Get all open PRs
 */
async function getOpenPRs() {
  const { data } = await octokit.pulls.list({
    owner,
    repo,
    state: "open",
    per_page: 50,
  });
  return data;
}

/**
 * Check approvals
 */
async function hasEnoughApprovals(prNumber) {
  const { data: reviews } = await octokit.pulls.listReviews({
    owner,
    repo,
    pull_number: prNumber,
  });
  const approved = new Set(
    reviews.filter((r) => r.state === "APPROVED").map((r) => r.user.login)
  );
  return approved.size >= REQUIRED_APPROVALS;
}

/**
 * Wait for external CI checks to pass
 */
async function waitForChecks(prSha) {
  const start = Date.now();
  while ((Date.now() - start) / 1000 < POLL_TIMEOUT) {
    const { data } = await octokit.checks.listForRef({ owner, repo, ref: prSha });
    // const checks = data.check_runs.filter(c => !c.name.includes("PullRequestLint"));

    console.log("ADSJKBAKDJbaksjdaksjdaskdjaskd", data.check_runs)

    if (checks.length === 0) return true;

    const allDone = checks.every(c => c.status === "completed");
    const allSuccess = checks.every(c => c.conclusion === "success");

    if (allDone && allSuccess) return true;
    if (allDone && !allSuccess) return false;

    console.log(`⏳ Waiting for checks on ${prSha}...`);
    await sleep(POLL_INTERVAL);
  }
  console.log("⏰ Timeout waiting for checks.");
  return false;
}

/**
 * Process a single PR
 */
async function processPR(pr) {
  console.log(`\n🔹 Processing PR #${pr.number}: ${pr.title}`);

  const latestPR = (await octokit.pulls.get({ owner, repo, pull_number: pr.number })).data;

  // Check label inside code
  const hasLabel = latestPR.labels.some(l => l.name === MERGE_LABEL);
  if (!hasLabel) {
    console.log(`⚠️ PR #${pr.number} missing label "${MERGE_LABEL}"`);
    hadFailure = true;
    return;
  }

  if (latestPR.state !== "open" || latestPR.merged) {
    console.log(`⚠️ PR #${pr.number} is closed or already merged`);
    hadFailure = true;
    return;
  }

  // if (!(await hasEnoughApprovals(pr.number))) {
  //   console.log(`⚠️ PR #${pr.number} does not have enough approvals`);
  //   hadFailure = true;
  //   return;
  // }

  // Update branch
  try {
    console.log(`🔄 Updating branch for PR #${pr.number}...`);
    await octokit.pulls.updateBranch({ owner, repo, pull_number: pr.number });
  } catch (err) {
    console.log(`⚠️ Could not update branch: ${err.message}`);
  }

  // Wait for CI
  const checksPassed = await waitForChecks(latestPR.head.sha);
  if (!checksPassed) {
    console.log(`❌ PR #${pr.number} failed CI or timed out`);
    hadFailure = true;
    return;
  }

  // Merge PR
  try {
    await octokit.pulls.merge({
      owner,
      repo,
      pull_number: pr.number,
      merge_method: "squash",
    });
    console.log(`🎉 PR #${pr.number} merged successfully!`);
  } catch (err) {
    console.log(`❌ Merge failed for PR #${pr.number}: ${err.message}`);
    hadFailure = true;
  }
}

/**
 * Main
 */
(async function main() {
  console.log(`🚀 Auto Merge Bot started for ${owner}/${repo}`);
  const prs = await getOpenPRs();
  if (!prs.length) return console.log("No open PRs found.");

  for (const pr of prs) {
    await processPR(pr);
  }

  if (hadFailure) {
    console.log("❌ One or more PRs failed to process. Failing workflow.");
    process.exit(1);
  }

  console.log("✅ All PRs processed successfully.");
})();
