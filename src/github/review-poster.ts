import { Octokit } from "@octokit/rest";
import type { ReviewComment } from "../review/types.js";

export async function postReview(
  octokit: Octokit,
  owner: string,
  repo: string,
  prNumber: number,
  comments: ReviewComment[],
  summary: string,
): Promise<void> {
  const inlineComments = comments.filter(
    (c): c is ReviewComment & { path: string; line: number } =>
      c.path !== null && c.line !== null,
  );
  const generalComments = comments.filter((c) => c.path === null);

  // Post inline comments as a PR review
  if (inlineComments.length > 0 || summary) {
    await octokit.rest.pulls.createReview({
      owner,
      repo,
      pull_number: prNumber,
      body: summary,
      event: "COMMENT",
      comments: inlineComments.map((c) => ({
        path: c.path,
        line: c.line,
        body: c.body,
      })),
    });
  }

  // Post general comments separately
  for (const comment of generalComments) {
    await octokit.rest.issues.createComment({
      owner,
      repo,
      issue_number: prNumber,
      body: comment.body,
    });
  }
}
