export function makeFooter(threadId: string, reviewId?: string): string {
  const tag = reviewId
    ? `thread::${threadId} | review::${reviewId}`
    : `thread::${threadId}`;
  return `\n\n---\n<sub>${tag}</sub>`;
}
