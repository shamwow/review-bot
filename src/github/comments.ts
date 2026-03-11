import { Octokit } from "@octokit/rest";

export async function addResolvedReactions(
  octokit: Octokit,
  owner: string,
  repo: string,
  commentId: number,
  commentType: "review_comment" | "issue_comment",
): Promise<void> {
  if (commentType === "review_comment") {
    await Promise.all([
      octokit.rest.reactions.createForPullRequestReviewComment({
        owner,
        repo,
        comment_id: commentId,
        content: "rocket",
      }),
      octokit.rest.reactions.createForPullRequestReviewComment({
        owner,
        repo,
        comment_id: commentId,
        content: "+1",
      }),
    ]);
  } else {
    await Promise.all([
      octokit.rest.reactions.createForIssueComment({
        owner,
        repo,
        comment_id: commentId,
        content: "rocket",
      }),
      octokit.rest.reactions.createForIssueComment({
        owner,
        repo,
        comment_id: commentId,
        content: "+1",
      }),
    ]);
  }
}

export async function addResolvedReactionsToGeneralComment(
  octokit: Octokit,
  owner: string,
  repo: string,
  prNumber: number,
  threadId: string,
): Promise<void> {
  const comments = await octokit.paginate(
    octokit.rest.issues.listComments,
    { owner, repo, issue_number: prNumber, per_page: 100 },
  );

  const target = comments.find(
    (c) => c.body?.includes(`thread::${threadId}`),
  );
  if (!target) return;

  await addResolvedReactions(octokit, owner, repo, target.id, "issue_comment");
}

function hasBothReactionsFromBot(
  reactions: Array<{ user: { login: string } | null; content: string }>,
  botLogin: string,
): boolean {
  let hasRocket = false;
  let hasThumbsUp = false;
  for (const r of reactions) {
    if (r.user?.login !== botLogin) continue;
    if (r.content === "rocket") hasRocket = true;
    if (r.content === "+1") hasThumbsUp = true;
  }
  return hasRocket && hasThumbsUp;
}

export async function fetchResolvedThreadIds(
  octokit: Octokit,
  owner: string,
  repo: string,
  prNumber: number,
  botLogin: string,
): Promise<Set<string>> {
  const resolved = new Set<string>();

  // Check inline review comments authored by the bot
  const reviewComments = await octokit.paginate(
    octokit.rest.pulls.listReviewComments,
    { owner, repo, pull_number: prNumber, per_page: 100 },
  );

  const botReviewComments = reviewComments.filter(
    (c) => c.user?.login === botLogin,
  );

  for (const comment of botReviewComments) {
    const reactions = await octokit.paginate(
      octokit.rest.reactions.listForPullRequestReviewComment,
      { owner, repo, comment_id: comment.id, per_page: 100 },
    );
    if (hasBothReactionsFromBot(reactions, botLogin)) {
      resolved.add(String(comment.id));
    }
  }

  // Check general issue comments authored by the bot
  const issueComments = await octokit.paginate(
    octokit.rest.issues.listComments,
    { owner, repo, issue_number: prNumber, per_page: 100 },
  );

  const botIssueComments = issueComments.filter(
    (c) => c.user?.login === botLogin,
  );

  for (const comment of botIssueComments) {
    const match = comment.body?.match(/thread::([a-f0-9-]+)/);
    if (!match) continue;

    const reactions = await octokit.paginate(
      octokit.rest.reactions.listForIssueComment,
      { owner, repo, comment_id: comment.id, per_page: 100 },
    );
    if (hasBothReactionsFromBot(reactions, botLogin)) {
      resolved.add(match[1]);
    }
  }

  return resolved;
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
