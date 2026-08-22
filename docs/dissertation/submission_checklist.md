# Submission Checklist — status as of 2026-08-22 (draft v0.1)

Document: `docs/dissertation/AI_QA_Agent_Dissertation_v0.1_draft.docx`

## Word count
- Counted dissertation body (Chapters 1–9, incl. in-chapter tables/captions): **12,146 words** — within the required 10,000–15,000.
- Total document (everything incl. front matter, references, appendices): **≈18,376 words**.
- Excluded from the counted figure, per KLE: contents pages, abstract, reference list, appendices.

## Formatting (KLE rules)
- [x] A4 page size; one-sided layout
- [x] Binding/left margin 1.5 in; all other margins 1 in
- [x] Times New Roman throughout (Courier New only for verbatim code listings in appendices)
- [x] Double line spacing in body text (single only in tables, captions and code listings — treated as indented-quotation equivalents; confirm acceptability)
- [x] Consecutive page numbering, bottom-right (suppressed visually on the title page; still counted)
- [x] Automatic Table of Contents + automatic Lists of Figures and Tables (SEQ/TOC fields; Word will prompt to update fields on first open — choose "Yes", or select-all → F9, then verify)
- [x] Consistent heading hierarchy; each chapter/appendix starts on a new page
- [ ] Official KLE template applied — **BLOCKED: template file not yet supplied**
- [ ] Official title page — **BLOCKED: placeholder page in use; official document not yet supplied**

## Content completeness
- [x] Title page (placeholder) · Abstract · Acknowledgement (placeholder) · Candidate's Declaration (generic wording, official wording pending) · ToC · List of Figures · List of Tables · List of Appendices · List of Abbreviations
- [x] Chapters 1–9 complete (third-person passive, past tense)
- [x] References: 18 verified Harvard entries; every in-text citation is in the list and vice versa (verified against reference_verification.md v2)
- [x] Appendices A–K, including anonymised primary-data samples (E1 export table, eval_report.json, loss milestones, verbatim JUnit failure), CI workflow, prompts, validation gate, sample generated tests + provenance, repository reference, approved proposal, fine-tuning configs
- [x] 4 figures (2 architecture diagrams from confirmed design; 2 data charts from verified raw data), 13 tables — all numbered via fields, captioned, sourced and discussed in text
- 12 × `[EVIDENCE REQUIRED]` and 5 × `[PLACEHOLDER]` marks remain visible in red/bold — deliberate; resolve before final.

## Outstanding before FINAL submission
1. Official KLE template + title page → re-flow document into it.
2. Student number, supervisor, school/university names, submission date, programme title → title page.
3. Official Candidate's Declaration wording + Submission Declaration Form.
4. Ethical approval document → Appendix A.
5. SRS extract → Appendix H; Table 1 cross-check.
6. Application screenshots → Appendix G.
7. GitHub Actions run evidence (time-sensitive) → Ch7 §7.3 + Appendix C addendum, or the design-only claim stands.
8. PostgreSQL export of per-model platform projects → Ch7 §7.2 pending mark.
9. Student decision on quarantined workbook tables (register §11a).
10. Fine-tuning hardware spec → Ch6/Appendix K.
11. Anonymisation actions in register §10 (repo-side) before any source submission.
12. Turnitin report — generated only through the university's official submission system; zip with the Word file per KLE instructions. **Never generated or imitated here.**
13. Final visual page-by-page inspection in Microsoft Word (fields updated, no clipped tables/orphaned headings) — automated checks passed; a human pass in Word is still required since no PDF renderer was available on this machine.
14. Academic-integrity / AI-use declaration per university policy (policy document still to be supplied).
