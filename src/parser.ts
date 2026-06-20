import { shortHash } from "./utils/hash";
import type { loomCodeBlock, loomNormalizedLanguage } from "./types";

const LANGUAGE_ALIASES: Record<string, loomNormalizedLanguage> = {
  python: "python",
  py: "python",
  javascript: "javascript",
  js: "javascript",
  typescript: "typescript",
  ts: "typescript",
  ocaml: "ocaml",
  ml: "ocaml",
  c: "c",
  h: "c",
  cpp: "cpp",
  cxx: "cpp",
  cc: "cpp",
  "c++": "cpp",
  shell: "shell",
  sh: "shell",
  bash: "shell",
  zsh: "shell",
  ruby: "ruby",
  rb: "ruby",
  perl: "perl",
  pl: "perl",
  lua: "lua",
  php: "php",
  go: "go",
  golang: "go",
  rust: "rust",
  rs: "rust",
  java: "java",
  llvm: "llvm-ir",
  llvmir: "llvm-ir",
  "llvm-ir": "llvm-ir",
  ll: "llvm-ir",
  lean: "lean",
  lean4: "lean",
  coq: "coq",
  v: "coq",
  smt: "smtlib",
  smt2: "smtlib",
  smtlib: "smtlib",
  "smt-lib": "smtlib",
  z3: "smtlib",
};

const OUTPUT_START = /^<!--\s*loom:output:start\s+id=([a-f0-9]+)\s*-->$/i;
const OUTPUT_END = /^<!--\s*loom:output:end\s*-->$/i;
const FENCE_START = /^(```+|~~~+)\s*([^\s`]*)?.*$/;

export function normalizeLanguage(rawLanguage: string): loomNormalizedLanguage | null {
  const normalized = rawLanguage.trim().toLowerCase();
  return LANGUAGE_ALIASES[normalized] ?? null;
}

export function getSupportedLanguageAliases(): string[] {
  return Object.keys(LANGUAGE_ALIASES);
}

export function parseMarkdownCodeBlocks(filePath: string, source: string): loomCodeBlock[] {
  const lines = source.split(/\r?\n/);
  const blocks: loomCodeBlock[] = [];
  let ordinal = 0;
  let insideManagedOutput = false;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];

    if (insideManagedOutput) {
      if (OUTPUT_END.test(line.trim())) {
        insideManagedOutput = false;
      }
      continue;
    }

    if (OUTPUT_START.test(line.trim())) {
      insideManagedOutput = true;
      continue;
    }

    const fenceMatch = line.match(FENCE_START);
    if (!fenceMatch) {
      continue;
    }

    const startLine = i;
    const fenceIndent = getLeadingWhitespace(line);
    const fenceToken = fenceMatch[1];
    const sourceLanguage = (fenceMatch[2] ?? "").trim();
    const language = normalizeLanguage(sourceLanguage);

    let endLine = i;
    const contentLines: string[] = [];

    for (let j = i + 1; j < lines.length; j += 1) {
      const innerLine = lines[j];
      const trimmed = innerLine.trim();

      if (trimmed.startsWith(fenceToken) && /^(```+|~~~+)\s*$/.test(trimmed)) {
        endLine = j;
        i = j;
        break;
      }

      contentLines.push(stripFenceIndent(innerLine, fenceIndent));
      endLine = j;
    }

    if (!language) {
      continue;
    }

    ordinal += 1;
    const content = contentLines.join("\n");
    const contentHash = shortHash(content);
    const id = shortHash(`${filePath}:${ordinal}:${language}:${contentHash}`);

    blocks.push({
      id,
      ordinal,
      filePath,
      language,
      languageAlias: sourceLanguage.toLowerCase(),
      sourceLanguage,
      content,
      startLine,
      endLine,
      fenceStart: 0,
      fenceEnd: 0,
    });
  }

  return blocks;
}

export function findBlockAtLine(blocks: loomCodeBlock[], line: number): loomCodeBlock | null {
  return blocks.find((block) => line >= block.startLine && line <= block.endLine) ?? null;
}

function getLeadingWhitespace(line: string): string {
  const match = line.match(/^[\t ]*/);
  return match?.[0] ?? "";
}

function stripFenceIndent(line: string, fenceIndent: string): string {
  if (!fenceIndent) {
    return line;
  }

  let index = 0;
  while (index < fenceIndent.length && index < line.length && line[index] === fenceIndent[index]) {
    index += 1;
  }

  return line.slice(index);
}
