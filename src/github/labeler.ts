import { Octokit } from "@octokit/rest";

const BOT_LABELS = [
  "bot-review-needed",
  "bot-changes-needed",
  "bot-ci-pending",
  "human-review-needed",
  "bot-human-intervention",
];

export async function setLabel(
  octokit: Octokit,
  owner: string,
  repo: string,
  prNumber: number,
  labelName: string,
): Promise<void> {
  // Remove all bot labels first (ignore 404 if not present)
  await Promise.all(
    BOT_LABELS.map(async (label) => {
      try {
        await octokit.rest.issues.removeLabel({
          owner,
          repo,
          issue_number: prNumber,
          name: label,
        });
      } catch (err: unknown) {
        const status = (err as { status?: number }).status;
        if (status !== 404) throw err;
      }
    }),
  );

  // Add the new label
  await octokit.rest.issues.addLabels({
    owner,
    repo,
    issue_number: prNumber,
    labels: [labelName],
  });
}
