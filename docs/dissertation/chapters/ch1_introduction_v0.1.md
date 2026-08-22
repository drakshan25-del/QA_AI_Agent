<!-- EDITORIAL NOTE (not dissertation content, excluded from word count):
Draft v0.1 of Chapter 1. Target 1,000 counted words. Style: British English, third-person passive, past tense
(present tense used only where the state of practice is described). Objectives O1–O6 were approved with the outline.
Citations marked (Author, Year) will be finalised once the reference list is verified; none are invented. -->

# Chapter 1 — Introduction

## 1.1 Context and motivation

Software-as-a-Service (SaaS) applications are released on increasingly short cycles driven by agile development and continuous delivery. A typical product combines a web user interface, backend application programming interfaces (APIs), authentication, dashboards and third-party integrations, and each release can introduce regression risk at any of these layers simultaneously. Assuring quality under these conditions with manual testing, or with hand-maintained scripted automation, was identified in the project proposal as laborious, repetitive and difficult to keep aligned with a changing product: test suites decay as selectors, routes and payloads drift, and the effort of maintaining them competes directly with the effort of testing new behaviour.

At the same time, large language models (LLMs) have demonstrated a growing ability to read natural-language requirements and produce plausible test artefacts. The literature reviewed in Chapter 2 shows, however, that plausibility is not correctness: LLM-generated tests frequently fail to compile, hallucinate interface elements and API endpoints that do not exist, and degrade as the system under test evolves. A practical AI quality-assurance workflow therefore cannot consist of a model alone; it requires an architecture in which generation is grounded in observable fact, checked by deterministic tooling, and governed by human approval before anything is executed or released.

## 1.2 Problem statement

The problem addressed by this project was twofold. First, as an engineering problem: whether an end-to-end, governed pipeline could be constructed that turns uploaded requirement documents into executable, traceable Playwright and API test suites, executes them with live visibility, compares runs for regressions, and integrates with a continuous-integration pipeline — while keeping generated code untrusted until validated and approved. Second, as a research problem: whether the usefulness of such a system can be established with measurable software-quality metrics, including a comparison of candidate local LLMs and an assessment of whether task-specific fine-tuning of small, locally hosted models improves their output.

## 1.3 Aim and objectives

The aim of the project was to design, implement and empirically evaluate an AI quality-assurance agent for SaaS applications covering user-interface, API and regression testing with a CI/CD pipeline. The aim was decomposed into six objectives:

- **O1** — to design and implement a three-tier agentic platform that transforms requirement documents into reviewed test plans, test cases and automation code;
- **O2** — to ground code generation in observable evidence (live page structure and API specifications) and to gate it behind deterministic validation before execution;
- **O3** — to integrate the agent with Playwright for user-interface execution, an HTTP client harness for API testing, and GitHub Actions for regression-gated continuous integration;
- **O4** — to evaluate candidate pre-trained local LLMs on measurable criteria including accuracy, completeness, requirement coverage, consistency, hallucination, executability and response time;
- **O5** — to fine-tune local models for the planning and coding tasks and to re-evaluate them against their base counterparts; and
- **O6** — to assess the safety and governance mechanisms — approval gates, validation ordering and audit — that keep a human in control of the workflow.

## 1.4 Research questions

Three research questions, fixed in the approved proposal and research-question document, structured the investigation:

- **RQ1 (What).** What input artefacts, such as user stories, requirements, API specifications, and test execution logs, are required for an AI QA agent to generate useful testing outputs?
- **RQ2 (Why).** Why is it important to evaluate AI-generated test outputs using measurable software quality metrics rather than relying only on human judgement?
- **RQ3 (How).** How can the AI QA agent be integrated with testing tools such as Playwright, API testing frameworks, and GitHub Actions?

RQ1 was addressed through the ingestion and grounding design and through the construction of the fine-tuning dataset; RQ2 through the metric framework, the deterministic gates and — most sharply — through a documented case in which measured behaviour contradicted informal judgement of a fine-tuned model; RQ3 through the implemented integrations and their execution evidence. The mapping from each question to its evidence is maintained throughout and revisited explicitly in Chapter 8.

## 1.5 Scope and exclusions

The system was evaluated against a purpose-built demonstration SaaS application with deliberately seeded defects, not against a production system; all evaluation data was synthetic or self-authored, and no human participants were involved, so no usability or satisfaction study is claimed. Model evaluation was confined to locally hosted models of up to eight billion parameters, with cloud providers supported by the platform but not systematically compared. A substantial user-interface scanning extension was implemented on a separate branch but was not merged into the mainline system and is reported only as such. Findings whose raw evidence could not be verified during the audit were excluded from the results rather than reported with caveats.

## 1.6 Contributions

The project contributes: (i) a working, safety-oriented reference architecture for agentic test generation in which every AI proposal passes deterministic validation and versioned human approval before execution; (ii) a deterministic grounding-and-gating method that measurably rejects hallucinated locators and endpoints at generation time; (iii) a reproducible, fully synthetic fine-tuning pipeline for QA-specific planning and coding models, together with an honest before-and-after evaluation that includes negative findings; and (iv) an evidence-first evaluation of the whole workflow, including its failure modes, against a seeded-defect target application.

## 1.7 Structure of the dissertation

Chapter 2 reviews the literature on LLM-based test generation, agentic software engineering and evaluation practice, and derives the gap the project addresses. Chapter 3 sets out the methodology, requirements and ethical considerations. Chapters 4 and 5 present the system design and its implementation. Chapter 6 describes the experimental design and data collection; Chapter 7 reports and analyses the results; Chapter 8 discusses the findings against the research questions and examines threats to validity. Chapter 9 concludes with limitations and future work.

<!-- EDITORIAL NOTE: counted words ≈ 1,000. -->
