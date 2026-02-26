import { Octokit } from "@octokit/rest";

export async function postResolvedReply(
  octokit: Octokit,
  owner: string,
  repo: string,
  prNumber: number,
  commentId: number,
): Promise<void> {
  await octokit.rest.pulls.createReplyForReviewComment({
    owner,
    repo,
    pull_number: prNumber,
    comment_id: commentId,
    body: "REVIEW BOT RESOLVED",
  });
}

export async function postGeneralComment(
  octokit: Octokit,
  owner: string,
  repo: string,
  prNumber: number,
  body: string,
): Promise<void> {
  await octokit.rest.issues.createComment({
    owner,
    repo,
    issue_number: prNumber,
    body,
  });
}
