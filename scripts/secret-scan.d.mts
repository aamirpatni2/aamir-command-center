export const PATTERNS: [string, RegExp][];
export function scan(root: string, files: string[]): { file: string; line: number; kind: string; sample: string }[];
