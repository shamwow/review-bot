export type Platform = "ios" | "android" | "golang" | "react";

export interface ReviewComment {
  path: string | null;
  line: number | null;
  body: string;
}

export interface ThreadResponse {
  thread_id: string;
  resolved: boolean;
  response?: string;
}

export interface ArchitecturePassResult {
  architecture_comments: ReviewComment[];
  architecture_update_needed: {
    needed: boolean;
    reason?: string;
  };
  thread_responses: ThreadResponse[];
  summary?: string;
}

export interface DetailedPassResult {
  detail_comments: ReviewComment[];
  thread_responses: ThreadResponse[];
  summary?: string;
}

export interface MergedReviewResult {
  comments: ReviewComment[];
  thread_responses: ThreadResponse[];
  architecture_update_needed: {
    needed: boolean;
    reason?: string;
  };
  summary: string;
}

export interface BuildResult {
  success: boolean;
  output: string;
}

export interface PRInfo {
  owner: string;
  repo: string;
  number: number;
  branch: string;
  title: string;
}
