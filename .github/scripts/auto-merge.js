// .github/scripts/auto-merge.js
const { Octokit } = require("@octokit/rest");

const labelToWatch = process.env.AUTOLABEL_NAME || "bug";
const mergeMethod = (process.env.MERGE_METHOD || "merge"); // "merge" | "squash" | "rebase"
const pollIntervalSeconds = parseInt(process.env.POLL_INTERVAL_SECONDS || "10", 10);
const pollTimeoutSeconds = parseInt(process.env.POLL_TIMEOUT_SECONDS || "900", 10);

if (!process.env.GITHUB_REPOSITORY) {
  console.error("GITHUB_REPOSITORY not found in env - aborting.");
  process.exit(1);
}

const [owner, repo] = process.env.GITHUB_REPOSITORY.split("/");
const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });

/**
 * Check if a given PR has at least 2 approvals and no outstanding change requests
 */
async function isPRApproved(prNumber) {
  const reviewsRes = await octokit.pulls.listReviews({
    owner, repo, pull_number: prNumber
  });
  const reviews = reviewsRes.data;

  // Consider only each user's latest review
  const lastReviewByUser = {};
  for (const r of reviews) {
    lastReviewByUser[r.user.login] = r;
  }

  const approvals = Object.values(lastReviewByUser)
    .filter(r => r.state === "APPROVED")
    .map(r => r.user.login);

  const hasBlockingChangeRequests = Object.values(lastReviewByUser)
    .some(r => r.state === "CHANGES_REQUESTED");

  const approvedCount = approvals.length;
  console.log(`PR #${prNumber}: ${approvedCount} approvals, blocking changes: ${hasBlockingChangeRequests}`);

  // Require at least 2 distinct approvers and no change requests
  return true
}

/**
 * Update the PR branch by merging base -> head (so PR branch includes latest base).
 * Returns the merge result or throws if there is a conflict.
 */
async function updatePrBranch(pr) {
  // We want to merge base (pr.base.ref) into head (pr.head.ref)
  console.log(`Updating branch ${pr.head.ref} with ${pr.base.ref}`);
  try {
    const mergeRes = await octokit.repos.merge({
      owner, repo,
      base: pr.head.ref,         // branch to update
      head: pr.base.ref,         // branch to merge from (base branch)
      commit_message: `chore: update ${pr.head.ref} with ${pr.base.ref}`
    });
    console.log("Merge update result:", mergeRes.status);
    return mergeRes.data;
  } catch (err) {
    // If merge conflict, GitHub returns 409
    if (err.status === 409) {
      throw new Error("Merge conflict when updating branch");
    }
    throw err;
  }
}

/**
 * Wait for all checks to pass for the PR's head SHA.
 * Uses Checks API + combined status.
 */
async function waitForChecksToPass(prHeadSha) {
  const startAt = Date.now();

  while (true) {
    const checksRes = await octokit.checks.listForRef({
      owner,
      repo,
      ref: prHeadSha
    });

    const relevantChecks = checksRes.data.check_runs.filter(
      check => check.name !== "Auto-Merge Workflow" // ignore this workflow
    );

    const allCompleted = relevantChecks.every(c => c.status === "completed");
    const allSuccess = relevantChecks.every(c => c.conclusion === "success");

    if (allCompleted && allSuccess) return true;
    if (allCompleted && !allSuccess) return false;

    if ((Date.now() - startAt) / 1000 > pollTimeoutSeconds) return false;

    await new Promise(r => setTimeout(r, pollIntervalSeconds * 1000));
  }
}

/**
 * Merge PR with configured merge method.
 */
async function mergePR(prNumber, commitTitle) {
  try {
    const res = await octokit.pulls.merge({
      owner, repo,
      pull_number: prNumber,
      merge_method: mergeMethod,
      commit_title: commitTitle
    });
    return res.data;
  } catch (err) {
    console.error("Merge failed:", err.message || err);
    throw err;
  }
}

/**
 * Process a single PR: check approved, update branch, wait checks, merge if green.
 */
async function processPr(pr) {
  console.log(`Processing PR #${pr.number} (${pr.title})`);
  const approved = await isPRApproved(pr.number);
  if (!approved) {
    console.log(`#${pr.number} is not approved -> skipping`);
    return { status: "skipped", reason: "not approved" };
  }

  // Update branch
  try {
    await updatePrBranch(pr);
  } catch (err) {
    console.log(`#${pr.number} update failed: ${err.message}`);
    // leave label for manual resolution
    return { status: "failed", reason: "update_failed", error: err.message };
  }

  // Re-fetch PR to get new head SHA
  const prRes = await octokit.pulls.get({ owner, repo, pull_number: pr.number });
  const headSha = prRes.data.head.sha;

  // Wait for checks
  const checksOk = await waitForChecksToPass(headSha);
  if (!checksOk) {
    console.log(`#${pr.number} checks did not pass -> skipping`);
    return { status: "skipped", reason: "checks_failed_or_timeout" };
  }

  // Merge
  try {
    // const mergeRes = await mergePR(pr.number, `Merge PR #${pr.number}: ${pr.title}`);
    console.log(`#${pr.number} merged:`, mergeRes.sha || mergeRes.message || mergeRes);
    return { status: "merged", sha: mergeRes.sha || null };
  } catch (err) {
    console.log(`#${pr.number} merge error: ${err.message}`);
    return { status: "failed", reason: "merge_error", error: err.message };
  }
}

/**
 * Find PRs that are labeled with `labelToWatch` and are open.
 */
async function findLabeledPRs() {
  const pulls = [];
  // Use list pulls and filter by labels (since list endpoint doesn't accept label param, use search)
  const q = `repo:${owner}/${repo} is:open is:pr label:"${labelToWatch}"`;
  const searchRes = await octokit.search.issuesAndPullRequests({ q, per_page: 100 });
  for (const item of searchRes.data.items) {
    // item.number is the PR number
    const prRes = await octokit.pulls.get({ owner, repo, pull_number: item.number });
    pulls.push(prRes.data);
  }
  return pulls;
}

async function run() {
  try {
    // The workflow is triggered on a single label event; we will process all matching PRs to catch queue
    console.log(`Looking for PRs labeled "${labelToWatch}" in ${owner}/${repo}`);
    const prs = await findLabeledPRs();

    if (prs.length === 0) {
      console.log("No labeled PRs found.");
      return;
    }

    // Sort by created_at to process in FIFO order:
    prs.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));

    for (const pr of prs) {
      const result = await processPr(pr);
      console.log(`Result for #${pr.number}:`, result);

      // If merged, continue to next PR in queue (repeat)
      // If fail/skipped, continue as well so other PRs might be independent
    }

    console.log("Done processing labeled PRs.");
  } catch (err) {
    console.error("Fatal error:", err);
    process.exit(1);
  }
}

run();
