# Full Mock Selection Algorithm

How a full-exam paper is sampled. Implementation must match this file.

The exam blueprint is **not** a suggestion. If it is inconsistent or the bank is short, generation **fails** and nothing is persisted.

---

## Blueprint guards (run before any sampling)

Load the exam (`isActive`, not deleted). Then:

1. `subjects.length >= 1`.
2. Every subject row has `numberOfQuestions >= 1` and a valid subject ObjectId.
3. `sum(subjects.numberOfQuestions) === totalQuestions`. If `totalQuestions` is missing, fail.
4. If `totalMarks` is set: `sum(numberOfQuestions * marksPerQuestion) === totalMarks`.
5. Mixed (`isSessionWise === false`): `duration` must be `> 0`.
6. Session-wise (`isSessionWise === true`): every subject must have `sessionTime > 0`.

Failure shape (HTTP 400):

```json
{
  "message": "Exam blueprint is inconsistent",
  "code": "BLUEPRINT_INVALID",
  "details": [
    { "rule": "TOTAL_QUESTIONS_MISMATCH", "expected": 100, "actual": 80 }
  ]
}
```

Do not invent missing duration, marks, or subject rows.

---

## Per-subject sampling

Process `exam.subjects[]` **in order**. For subject row `S` pick **exactly** `S.numberOfQuestions`.

### 1. Topics

Load the Subject. Use `Subject.topics` filtered to topics that are active and not deleted.

If the subject has **no usable topics**, treat the subject as a single bucket: match `subject` only (any/no topic), still require `difficultyLevel` set, active, not deleted.

### 2. Inventory

For each usable topic, count eligible questions:

```
subject = S.subject
topic   = topicId          // omitted only in the no-topics fallback
isActive: true
isDeleted: false
difficultyLevel exists     // questions without difficulty are never sampled
```

Do **not** filter on `Question.exams[]`. Exam is filing + blueprint only.

### 3. Topic quotas (largest remainder)

Let `T` = topics with `inventory > 0`. If `sum(inventory) < S.numberOfQuestions`, abort:

```json
{
  "message": "Not enough questions for subject",
  "code": "BANK_SHORTAGE",
  "details": {
    "subjectId": "...",
    "subjectName": "Quantitative Aptitude",
    "needed": 25,
    "available": 12
  }
}
```

Nothing is saved (no draft, no partial paper).

Otherwise allocate `S.numberOfQuestions` seats across `T`:

```
base(t)      = floor(S.numberOfQuestions * inventory(t) / sum(inventory))
remainder    = S.numberOfQuestions - sum(base)
```

Give one extra seat to the topics with the largest fractional remainder, in that order, without exceeding `inventory(t)`.

If any leftover seats remain (because some topics hit inventory cap), spill to other topics that still have spare inventory, ordered by remaining inventory descending.

A topic with `inventory === 0` gets quota `0`.

### 4. Weighted sample without replacement

For each topic with quota `q > 0`, load eligible question docs (ids + `fullMockUsageCount` + `lastUsedInFullMockAt` + `difficultyLevel`).

Weight:

```
recencyPenalty = 0.4  if lastUsedInFullMockAt is within the last 14 days
                 1.0  otherwise

weight = (1 / (1 + fullMockUsageCount)^1.5) * recencyPenalty * (0.85 + 0.15 * random())
```

Sample `q` distinct questions by walking a weighted lottery (without replacement). A question id already picked earlier in **this paper** is ineligible (global paper set).

Missing `fullMockUsageCount` is treated as `0`.

`$sample` is **not** used. It cannot apply usage weights.

### 5. Concatenate

Append the subject’s picks in topic order (stable, easier to review). Then move to the next subject.

Paper order = subject blocks. Within a subject, topic groups stay together.

Create-draft and publish **re-group** questions into contiguous exam-subject order and rewrite `position` `0..n-1`, so a later replace cannot leave interleaved subjects on the published paper.

Each picked question stores on the draft:

- `position` (0-based across the whole paper)
- `subject`, `topic`, `difficultyLevel`
- `marksPerQuestion` = `S.marksPerQuestion`
- `negativeMarking` = `S.hasNegativeMarking ? S.negativeMarksPerQuestion : 0`

---

## Explicit difficulty split (optional)

`POST /full-mock-tests/drafts` accepts an optional `difficultyDistribution`:

```json
{
  "examId": "...",
  "difficultyDistribution": [
    { "subjectId": "...", "easy": 8, "medium": 10, "hard": 7 }
  ]
}
```

- Must list **every** exam subject exactly once; `easy + medium + hard` must equal that subject's `numberOfQuestions`. Otherwise HTTP 400 `DIFFICULTY_DISTRIBUTION_INVALID`; `details[]` has one `{ rule, subjectName, message, ... }` per problem.
- Before sampling, the bank is counted per (subject, difficulty). If any cell is short, nothing is saved and HTTP 400 `BANK_SHORTAGE` lists **all** shortages in `details[]`: `{ subjectName, difficulty, needed, available, message }`.
- Sampling then runs per subject, per difficulty (easy → medium → hard), with the same topic-proportional quotas and usage-weighted lottery described above, restricted to that difficulty.
- When `difficultyDistribution` is omitted, behaviour is unchanged (no difficulty control).
- `GET /full-mock-tests/exams` items include `subjectDetails[]` (`subjectId`, `name`, `numberOfQuestions`) so the admin UI can build the split.

## Usage accounting

On **publish only**:

```
fullMockUsageCount += 1
lastUsedInFullMockAt = now
```

for every question id on the published paper.

Generate / replace / discard must **not** increment usage. Discarded drafts do not burn the bank.

Topic-wise mock creation does not read or write these fields.

---

## Replace constraints

`PATCH /full-mock-tests/drafts/:id/questions/:position`

- Draft status must be `REVIEW`.
- `position` must exist.
- Incoming `questionId` must be active, not deleted, have `difficultyLevel`.
- Incoming question **subject must equal the slot’s subject** unless `allowCrossSubject` is true (keeps quota, marks, and session block).
- Incoming question **must be tagged to the draft exam** (`questions.exams` contains `draft.exam`).
- Incoming question must not already appear elsewhere on the draft.
- Topic **may** change (admin can swap in a different topic, including from another subject when opted in).
- Set `replacedFrom` to the previous question id.
- Do **not** change `marksPerQuestion` / `negativeMarking` / `position` / slot `subject`.

Replace-picker search (`GET /full-mock-tests/questions`):

- `subjectId` required unless `allowCrossSubject=true`.
- Optional `search` (question text), `topicId`, `difficultyLevel`.
- Exclude ids already on the given draft (`draftId` query).
- When `draftId` is set, only questions tagged to that draft’s exam (`exams` contains `draft.exam`).
- `allowCrossSubject=true` requires `draftId`; `subjectId` may be omitted to list all exam-tagged questions.
- Return safe fields only (no `correctAnswer`, no `explanation`).

---

## Failure codes

| Code | When |
|---|---|
| `BLUEPRINT_INVALID` | Exam missing/inconsistent totals, duration, or session times. |
| `BANK_SHORTAGE` | A subject does not have enough eligible questions. |
| `EXAM_NOT_FOUND` | Exam id missing or deleted/inactive. |
| `DRAFT_NOT_EDITABLE` | Replace/publish on a non-`REVIEW` draft. |
| `SUBJECT_MISMATCH` | Replacement question belongs to a different subject. |
| `EXAM_MISMATCH` | Replacement question is not tagged to the draft’s exam. |
| `DUPLICATE_QUESTION` | Replacement id already on the paper, or publish/generate found the same question more than once. |
| `QUESTION_NOT_ELIGIBLE` | Inactive, deleted, or no difficulty. |
