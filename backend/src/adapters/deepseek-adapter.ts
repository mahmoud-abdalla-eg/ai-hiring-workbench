import https from "node:https";
import http from "node:http";
import { URL } from "node:url";
import { ModelAdapter, ModelAdapterOptions } from "./model-adapter.js";
import {
  EnterpriseTaskContext,
  SourceDocument,
  SourceClaim,
  RoleRequirement,
  SearchExpressionSet,
  TaskRecord,
  ProjectEpisode,
  RequirementAssessment
} from "../domain/types.js";
import { EvidenceState } from "../domain/evidence-states.js";

export class DeepSeekAdapter implements ModelAdapter {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly chatModel: string;
  private readonly reasonerModel: string;
  private readonly timeoutMs: number;

  constructor(options: ModelAdapterOptions = {}) {
    this.apiKey = options.apiKey || process.env.DEEPSEEK_API_KEY || "";
    this.baseUrl = (options.baseUrl || process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com").replace(/\/$/, "");
    this.chatModel = options.chatModel || process.env.DEEPSEEK_CHAT_MODEL || "deepseek-chat";
    this.reasonerModel = options.reasonerModel || process.env.DEEPSEEK_REASONER_MODEL || "deepseek-reasoner";
    this.timeoutMs = options.timeoutMs || 60000;
  }

  private async callLlm(model: string, systemPrompt: string, userPrompt: string, responseJson = true): Promise<any> {
    if (!this.apiKey) {
      throw new Error("DEEPSEEK_API_KEY is not configured. Set MODEL_PROVIDER=mock or provide API key in .env.");
    }

    const body: Record<string, any> = {
      model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ],
      temperature: model === this.reasonerModel ? 0.3 : 0.1
    };

    if (responseJson && model !== this.reasonerModel) {
      body.response_format = { type: "json_object" };
    }

    const parsedUrl = new URL(`${this.baseUrl}/chat/completions`);
    const postData = JSON.stringify(body);
    const isHttps = parsedUrl.protocol === "https:";
    const transport = isHttps ? https : http;

    const data = await new Promise<any>((resolve, reject) => {
      const req = transport.request(
        {
          hostname: parsedUrl.hostname,
          port: parsedUrl.port || (isHttps ? 443 : 80),
          path: parsedUrl.pathname + parsedUrl.search,
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${this.apiKey}`,
            "Content-Length": Buffer.byteLength(postData)
          },
          timeout: this.timeoutMs
        },
        res => {
          let resBody = "";
          res.on("data", chunk => {
            resBody += chunk;
          });
          res.on("end", () => {
            if (res.statusCode && res.statusCode >= 400) {
              reject(new Error(`DeepSeek API error (${res.statusCode}): ${resBody}`));
            } else {
              try {
                resolve(JSON.parse(resBody));
              } catch (e) {
                reject(new Error(`Failed to parse DeepSeek response JSON: ${resBody}`));
              }
            }
          });
        }
      );

      req.on("error", reject);
      req.on("timeout", () => {
        req.destroy(new Error(`DeepSeek API request timed out after ${this.timeoutMs}ms`));
      });

      req.write(postData);
      req.end();
    });

    const content = data.choices?.[0]?.message?.content || "";

    if (responseJson) {
      // Strip markdown code blocks if model wrapped it in ```json ... ```
      const cleaned = content.replace(/^```json\s*/i, "").replace(/```\s*$/i, "").trim();
      return JSON.parse(cleaned);
    }
    return content;
  }

  async clarifyTask(department: string, targetRole: string, rawDescription: string): Promise<EnterpriseTaskContext> {
    const systemPrompt = `You are an expert HR Technology task structurer. Parse the hiring manager's informal input into a structured enterprise business task context. Return strictly a JSON object with keys: businessProblem, targetUsers (array of strings), deliverables (array of strings), constraints (array of strings), openQuestions (array of strings).`;
    const userPrompt = `Department: ${department}\nRole: ${targetRole}\nRaw Description: ${rawDescription}`;
    
    const result = await this.callLlm(this.chatModel, systemPrompt, userPrompt);
    return {
      department,
      targetRole,
      businessProblem: result.businessProblem || "",
      targetUsers: result.targetUsers || [],
      deliverables: result.deliverables || [],
      constraints: result.constraints || [],
      openQuestions: result.openQuestions || []
    };
  }

  async extractClaims(source: SourceDocument): Promise<SourceClaim[]> {
    const systemPrompt = `You are a job requirement claim extractor. Extract atomic claims from the provided job document. Each claim must have a verbatim quoteSnapshot from the text. Return JSON: { claims: [{ id, claimType: "REQUIREMENT"|"DELIVERABLE"|"CONSTRAINT"|"PREFERENCE", statement, sourceExcerptIds: [id], quoteSnapshot }] }`;
    const userPrompt = `Document: ${source.title}\nPublisher: ${source.publisher}\nLines:\n${source.textLines.join("\n")}`;

    const result = await this.callLlm(this.chatModel, systemPrompt, userPrompt);
    return (result.claims || []).map((c: any, idx: number) => ({
      ...c,
      id: c.id || `CLM_${source.id}_${idx + 1}`,
      sourceId: source.id,
      sourceExcerptIds: c.sourceExcerptIds || [source.id]
    }));
  }

  async adjudicateConflicts(claims: SourceClaim[]): Promise<{
    claims: SourceClaim[];
    contradictionsFound: Array<{ claimIdA: string; claimIdB: string; explanation: string }>;
  }> {
    // DeepSeek-R1 deep reasoning model
    const systemPrompt = `You are a hiring standard adjudicator with deep analytical reasoning. Cross-compare the claims to detect hard contradictions (e.g. coding required vs no-code allowed). Return JSON: { contradictions: [{ claimIdA, claimIdB, explanation }] }`;
    const userPrompt = `Claims to cross-evaluate:\n${JSON.stringify(claims, null, 2)}`;

    const result = await this.callLlm(this.reasonerModel, systemPrompt, userPrompt);
    const contradictions = result.contradictions || [];

    const updatedClaims = claims.map(c => {
      const conflict = contradictions.find((ct: any) => ct.claimIdA === c.id || ct.claimIdB === c.id);
      if (conflict) {
        return {
          ...c,
          hasContradiction: true,
          contradictionNote: conflict.explanation
        };
      }
      return c;
    });

    return { claims: updatedClaims, contradictionsFound: contradictions };
  }

  async synthesizeDraftRequirements(taskContext: EnterpriseTaskContext, claims: SourceClaim[]): Promise<RoleRequirement[]> {
    const systemPrompt = `You are an emerging role standard designer. Synthesize a unified hiring rubric for the role. Generate 4 to 6 core requirements (e.g. AIPM-AP1, AIPM-AP2). Return JSON: { requirements: [{ id, code, name, definition, evidenceRequired, status: "DRAFT" }] }`;
    const userPrompt = `Task Context: ${JSON.stringify(taskContext)}\nClaims: ${JSON.stringify(claims)}`;

    const result = await this.callLlm(this.chatModel, systemPrompt, userPrompt);
    return (result.requirements || []).map((r: any, idx: number) => ({
      ...r,
      id: r.id || `REQ_${idx + 1}`,
      status: "DRAFT"
    }));
  }

  async generateSearchExpressions(standardVersionId: string, requirements: RoleRequirement[]): Promise<SearchExpressionSet> {
    const systemPrompt = `You are an ATS search term synthesizer. Synthesize search query terms for candidate recall based on requirements. Return JSON: { titleTerms: string[], taskTerms: string[], skillTerms: string[], exclusionTerms: string[], booleanQuery: string }`;
    const userPrompt = `Requirements:\n${JSON.stringify(requirements)}`;

    const result = await this.callLlm(this.chatModel, systemPrompt, userPrompt);
    return {
      id: `SE_${standardVersionId}_${Date.now()}`,
      standardVersionId,
      titleTerms: result.titleTerms || [],
      taskTerms: result.taskTerms || [],
      skillTerms: result.skillTerms || [],
      exclusionTerms: result.exclusionTerms || [],
      booleanQuery: result.booleanQuery || "",
      humanEdited: false
    };
  }

  async extractCandidateFacts(candidateId: string, rawTextLines: string[]): Promise<{
    taskRecords: TaskRecord[];
    projectEpisodes: ProjectEpisode[];
  }> {
    const systemPrompt = `You are a resume factual extractor. Extract verified TaskRecords and ProjectEpisodes from line-numbered resume text. Each entry MUST cite line anchors (e.g. ["L005", "L008"]). Return JSON: { taskRecords: [{ id, action, object, deliverable, metric, anchorIds: string[] }], projectEpisodes: [{ id, problem, personalAction, artifact, validation, iteration, anchorIds: string[] }] }`;
    const userPrompt = `Candidate ID: ${candidateId}\nResume text lines:\n${rawTextLines.join("\n")}`;

    const result = await this.callLlm(this.chatModel, systemPrompt, userPrompt);
    return {
      taskRecords: result.taskRecords || [],
      projectEpisodes: result.projectEpisodes || []
    };
  }

  async linkEvidence(
    candidateId: string,
    rawTextLines: string[],
    episodes: ProjectEpisode[],
    tasks: TaskRecord[],
    requirements: RoleRequirement[]
  ): Promise<RequirementAssessment[]> {
    // DeepSeek-R1 deep causal reasoning model
    const systemPrompt = `You are an evidence attribution reasoning engine. For each requirement, evaluate candidate execution against 4 discrete evidence states:
- "SUPPORTED": Clear personal verified deliverable and metrics with specific line citations.
- "PARTIAL": Relevant execution or partial attempt present, but lacks systematic taxonomy, root-cause categorization, or complete deliverables.
- "MATERIAL_INSUFFICIENT": Applicant explicitly notes limitation, sample size too small (e.g. manual check of few samples), or lacks formal evaluation harness.
- "NO_EVIDENCE": Unmentioned in material (apply Null Competency).

Never output arbitrary match scores or percentages. Anchor claims to line numbers. If evidence is not SUPPORTED, level must be null. Return JSON: { assessments: [{ requirementId, requirementCode, evidenceStatus, level, reasons, ruleIds: string[], anchorIds: string[] }] }`;
    const userPrompt = `Requirements:\n${JSON.stringify(requirements)}\n\nExtracted Episodes:\n${JSON.stringify(episodes)}\n\nExtracted Tasks:\n${JSON.stringify(tasks)}\n\nRaw Resume:\n${rawTextLines.join("\n")}`;

    const result = await this.callLlm(this.reasonerModel, systemPrompt, userPrompt);
    return result.assessments || [];
  }

  async synthesizeInterviewPrompts(
    roleName: string,
    assessments: RequirementAssessment[],
    rawResumeLines: string[]
  ): Promise<string[]> {
    const systemPrompt = `You are an expert technical interviewer. Generate 3 to 5 targeted behavioral and technical follow-up questions targeting the candidate's diagnosed evidence gaps (PARTIAL or MATERIAL_INSUFFICIENT areas). Return JSON: { questions: string[] }`;
    const userPrompt = `Role: ${roleName}\nAssessments:\n${JSON.stringify(assessments)}`;

    const result = await this.callLlm(this.chatModel, systemPrompt, userPrompt);
    return result.questions || [];
  }
}
