# Benchmark Evaluation Report

> **Run Timestamp:** `2026-09-26T08:33:45.349Z`  
> **Engine Mode:** `LIVE DeepSeek API`  
> **Frozen Standard ID:** `STD_1790411502937`  
> **Standard SHA-256:** `75677a028c318682ec4106045165211b3446990efa0350ffc37c424635189a67`  
> **Overall Result:** **FAILED ✗**

---

## 1. E-HR Suite: Candidate Omission & Triage

| Metric | Target | Measured Result | Status |
| :--- | :---: | :---: | :---: |
| **Total Candidates Evaluated** | 4 | 4 | Completed |
| **Rescue Recall Rate (RRR)** | $\ge 80\%$ | **100.0%** | PASS ✓ |
| **Anti-Overestimation Precision (AOP)** | $\ge 75\%$ | **100.0%** | PASS ✓ |
| **Line Citation Grounding Rate** | $100\%$ | **100.0%** | PASS ✓ |

---

## 2. E-STU Suite: Student Evidence Diagnosis

| Metric | Target | Measured Result | Status |
| :--- | :---: | :---: | :---: |
| **Diagnostic Agreement Rate** | $\ge 80\%$ | **33.3%** | FAIL ✗ |
| **Interview Follow-ups Generated** | $\ge 2$ | **5 Prompts** | PASS ✓ |
| **Prohibited Score Check (Rule R-11)** | Zero Match % | **COMPLIANT (Zero % Scores)** | PASS ✓ |

---

## 3. Compliance & Governance Verification
* **Rule R-03**: No evidence $\rightarrow$ Unsupported with zero speculative rating.
* **Rule R-05**: 100% of claims carry verbatim quote spans with source line indices.
* **Rule R-10**: Mandatory justification recorded for any human override.
* **Rule R-14**: Anonymized candidate IDs with PII redaction log hook.
