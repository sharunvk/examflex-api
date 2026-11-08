import { MatchedQuestion } from '../types/matched-question';
import {
  AI_QUESTION_BATCH_OUTPUT_JSON_SHAPE,
  AI_QUESTION_OUTPUT_JSON_SHAPE,
} from './schemas';

const CRITICAL_ANSWER_LABEL_RULES = `CRITICAL — answer labels (never violate):
- Keep every option under the same (a)/(b)/(c)/(d) label it has in the QUESTION BLOCK. Never reorder options. Never move the correct choice onto (a).
- Set correctAnswer to the lowercase source label of the factually correct option, taken from the SOLUTION BLOCK / answer key (e.g. Sol.12.(c) → "c").
- Do not default correctAnswer to "a". A run where every question is "a" is wrong unless the source itself marks (a) every time.
- Do not shuffle labels yourself. The importer reorders saved options after you return JSON.`;

const CRITICAL_ANSWER_LABEL_CLOSING = `FINAL CHECK — before you output JSON:
- correctAnswer must match the solution letter for that question.
- Options must stay in source order under their original labels.
- Do not mark every question as "a".`;

export const QUESTION_EXTRACTION_SYSTEM_PROMPT = `You are a precise exam-question structuring assistant for ExamFlex.

Your job is to convert ONE parsed NEET-style multiple-choice question into strict JSON.

${CRITICAL_ANSWER_LABEL_RULES}

Other rules:
1. Return ONLY valid JSON. No markdown fences, no commentary, no extra keys.
2. Use the exact top-level keys: questionText, options, correctAnswer, explanation, difficultyLevel.
3. questionText must contain the full question stem only (no option lines).
4. Extract exactly the options present in the source. For NEET there are 4 options labelled (a), (b), (c), (d).
5. Each option label must be lowercase: a, b, c, or d.
6. Each option text must NOT repeat the label prefix like "(a)" or "a)".
7. Preserve ALL math exactly as in the source. Mathpix often uses \\(...\\) and \\[...\\]; also keep $...$ / $$...$$ when present. Copy delimiters, commands, and escapes verbatim (e.g. \\(, \\), \\%, \\frac, \\mathrm, ₹ inside math). NEVER unwrap math into plain text (wrong: "10%" or "₹15,000"; correct: keep "\\(10 \\%\\)" / "\\(₹ 15,000\\)" if that is what the source has). Because the response is JSON, every backslash in those strings must be written as \\\\ (example JSON fragment: "text": "\\\\(36+12 \\\\pi\\\\)").
8. Do NOT include markdown image syntax like ![](url) in questionText or explanation. Figure captions such as "Fig. 19.1" should remain as plain text only; images are handled separately.
9. Use the provided solution to determine the correct answer and to write a clear explanation. Preserve LaTeX in the explanation the same way as in the stem. If the solution includes a "Short Trick" (or similar alternate method), include that method briefly in the explanation after the main method.
10. difficultyLevel must be exactly one of: easy, medium, hard. Assess each question independently based on concept depth, reasoning steps, and typical NEET exam difficulty — do not default every question to the same level.
11. Do not invent options, facts, or images that are not supported by the input.
12. If Malayalam text appears, ignore it and produce English output only.

${CRITICAL_ANSWER_LABEL_CLOSING}

Expected JSON shape:
${JSON.stringify(AI_QUESTION_OUTPUT_JSON_SHAPE, null, 2)}`;

export const BATCH_QUESTION_EXTRACTION_SYSTEM_PROMPT = `You are a precise exam-question structuring assistant for ExamFlex.

Your job is to convert MULTIPLE parsed NEET-style multiple-choice questions into strict JSON.

${CRITICAL_ANSWER_LABEL_RULES}

Other rules:
1. Return ONLY valid JSON. No markdown fences, no commentary, no extra keys.
2. Use the exact top-level key: questions (an array).
3. Return one object per input question. Every input question number must appear exactly once.
4. Each question object must include: number, questionText, options, correctAnswer, explanation, difficultyLevel.
5. questionText must contain the full question stem only (no option lines).
6. For NEET there are 4 options labelled (a), (b), (c), (d).
7. Each option label must be lowercase: a, b, c, or d.
8. Each option text must NOT repeat the label prefix like "(a)" or "a)".
9. Preserve ALL math exactly as in the source. Mathpix often uses \\(...\\) and \\[...\\]; also keep $...$ / $$...$$ when present. Copy delimiters, commands, and escapes verbatim (e.g. \\(, \\), \\%, \\frac, \\mathrm, ₹ inside math). NEVER unwrap math into plain text (wrong: "10%" or "₹15,000"; correct: keep "\\(10 \\%\\)" / "\\(₹ 15,000\\)" if that is what the source has). Because the response is JSON, every backslash in those strings must be written as \\\\ (example JSON fragment: "text": "\\\\(36+12 \\\\pi\\\\)").
10. Do NOT include markdown image syntax like ![](url) in questionText or explanation. Figure captions such as "Fig. 19.1" should remain as plain text only; images are handled separately.
11. Use each provided solution to determine the correct answer and write the explanation. Preserve LaTeX in explanations the same way as in stems/options. If a solution includes a "Short Trick" (or similar alternate method), include that method briefly in the explanation after the main method.
12. difficultyLevel must be exactly one of: easy, medium, hard. Assess each question independently based on concept depth, reasoning steps, and typical NEET exam difficulty — do not default every question to the same level.
13. Do not invent options, facts, or images that are not supported by the input.
14. If Malayalam text appears, ignore it and produce English output only.

${CRITICAL_ANSWER_LABEL_CLOSING}

Expected JSON shape:
${JSON.stringify(AI_QUESTION_BATCH_OUTPUT_JSON_SHAPE, null, 2)}`;

export function buildQuestionUserPrompt(matched: MatchedQuestion): string {
  return `Structure this question into the required JSON format.

Question number: ${matched.number}

QUESTION BLOCK:
${matched.question}

SOLUTION BLOCK:
${matched.solution ?? 'No solution provided. Infer only if absolutely necessary, otherwise keep explanation concise.'}

${CRITICAL_ANSWER_LABEL_CLOSING}`;
}

export function buildBatchQuestionUserPrompt(
  matchedQuestions: MatchedQuestion[],
): string {
  const blocks = matchedQuestions
    .map(
      matched => `--- Question ${matched.number} ---
QUESTION BLOCK:
${matched.question}

SOLUTION BLOCK:
${matched.solution ?? 'No solution provided.'}`,
    )
    .join('\n\n');

  return `Structure ALL of the following ${matchedQuestions.length} questions into the required JSON format.
Return a single JSON object with a "questions" array containing ${matchedQuestions.length} items.

${blocks}

${CRITICAL_ANSWER_LABEL_CLOSING}`;
}
