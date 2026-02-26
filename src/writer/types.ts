export interface WriteResult {
  threads_addressed: Array<{
    thread_id: string;
    explanation: string;
  }>;
  build_passed: boolean;
  summary: string;
}
