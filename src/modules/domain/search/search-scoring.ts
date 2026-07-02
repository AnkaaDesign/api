import { normalizeSearchTerm } from '../../../schemas/common';

/**
 * Relevance scoring for spotlight results.
 *
 * The database over-fetches candidates (substring match on normalized columns);
 * scoring then ranks them so exact identifier hits (serial number, uniCode,
 * plate, order number) surface above name matches, which surface above
 * matches that only occurred through relations or long descriptions.
 *
 * Scoring also tracks WHICH field matched best: when the winning field is not
 * visible in the rendered row (CPF, phone, paint relation, notes...), the
 * result carries a `match` hint so the user understands why it appeared.
 */

const MATCH_EXACT = 1000;
const MATCH_PREFIX = 600;
const MATCH_WORD_START = 400;
const MATCH_CONTAINS = 150;
const MATCH_ALL_TOKENS = 80;
// Candidate matched in the DB (e.g. via a relation not returned in the select)
// but none of the scored fields hit — keep it visible with a floor score.
const MATCH_RELATION_FLOOR = 40;

export interface ScoredField {
  value: string | number | null | undefined;
  /** Multiplier — identifier fields ~2, names ~1.5, relation/secondary fields <=1. */
  weight: number;
  /** Human label (pt-BR) used in the "matched by" hint. */
  label?: string;
  /** Field is NOT visible in the row (title/subtitle) — matching it produces a hint. */
  hidden?: boolean;
}

export interface CandidateScore {
  score: number;
  match: { label: string; value: string } | null;
}

function scoreField(rawValue: string | number | null | undefined, query: string, tokens: string[]): number {
  if (rawValue === null || rawValue === undefined) return 0;
  const value = normalizeSearchTerm(String(rawValue));
  if (!value) return 0;

  if (value === query) return MATCH_EXACT;
  if (value.startsWith(query)) return MATCH_PREFIX;
  if (value.includes(` ${query}`)) return MATCH_WORD_START;
  if (value.includes(query)) return MATCH_CONTAINS;
  // Multi-word queries: all tokens present, in any order ("ferrari vermelho")
  if (tokens.length > 1 && tokens.every((token) => value.includes(token))) return MATCH_ALL_TOKENS;
  return 0;
}

export function scoreCandidate(fields: ScoredField[], query: string, tokens: string[]): CandidateScore {
  let best = 0;
  let bestField: ScoredField | null = null;
  let matchedFields = 0;

  for (const field of fields) {
    const fieldScore = scoreField(field.value, query, tokens) * field.weight;
    if (fieldScore > 0) matchedFields++;
    if (fieldScore > best) {
      best = fieldScore;
      bestField = field;
    }
  }

  if (best === 0) return { score: MATCH_RELATION_FLOOR, match: null };

  const match = bestField?.hidden && bestField.label ? { label: bestField.label, value: String(bestField.value) } : null;

  // Small bonus when several fields match the same candidate.
  return { score: best + (matchedFields - 1) * 10, match };
}
