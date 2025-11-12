import { toRecord } from "./chat-helpers";
import type { PlanSectionFormState, ResearchPlanFormState } from "../types";

export function createEmptySection(): PlanSectionFormState {
  return { title: "", focus: "", keyQuestions: [] };
}

export function createEmptyPlanForm(): ResearchPlanFormState {
  return {
    purpose: "",
    sections: [createEmptySection()],
    structure: { introduction: "", conclusion: "" },
    metaAnalysis: "",
  };
}

export function parsePlanValue(value: unknown): ResearchPlanFormState {
  const base = createEmptyPlanForm();
  if (value === null || value === undefined) {
    return base;
  }

  let root: unknown = value;
  if (typeof value === "string") {
    try {
      root = JSON.parse(value) as unknown;
    } catch (error) {
      console.warn("[ui] Failed to parse plan JSON", error);
      return base;
    }
  }

  const rootRecord = toRecord(root);
  if (!rootRecord) {
    return base;
  }

  const planRecord =
    toRecord(rootRecord["research_plan"]) ?? toRecord(rootRecord["plan"]) ?? rootRecord;

  const structureRecord = toRecord(planRecord["structure"]);

  const sectionsValue = planRecord["sections"];
  const sections: PlanSectionFormState[] = Array.isArray(sectionsValue)
    ? sectionsValue
        .map((item) => {
          const sectionRecord = toRecord(item);
          if (!sectionRecord) {
            return createEmptySection();
          }
          const keysValue =
            sectionRecord["key_questions"] ?? sectionRecord["keyQuestions"];
          const questions = Array.isArray(keysValue)
            ? keysValue
                .map((entry) => (typeof entry === "string" ? entry : String(entry ?? "")))
                .filter((entry) => entry !== undefined)
            : [];
          return {
            title:
              typeof sectionRecord["title"] === "string"
                ? (sectionRecord["title"] as string)
                : "",
            focus:
              typeof sectionRecord["focus"] === "string"
                ? (sectionRecord["focus"] as string)
                : "",
            keyQuestions: questions,
          };
        })
        .filter(Boolean)
    : [createEmptySection()];

  const plan: ResearchPlanFormState = {
    purpose:
      typeof planRecord["purpose"] === "string"
        ? (planRecord["purpose"] as string)
        : "",
    sections: sections.length > 0 ? sections : [createEmptySection()],
    structure: {
      introduction:
        typeof structureRecord?.["introduction"] === "string"
          ? (structureRecord["introduction"] as string)
          : "",
      conclusion:
        typeof structureRecord?.["conclusion"] === "string"
          ? (structureRecord["conclusion"] as string)
          : "",
    },
    metaAnalysis:
      typeof rootRecord["meta_analysis"] === "string"
        ? (rootRecord["meta_analysis"] as string)
        : typeof rootRecord["metaAnalysis"] === "string"
          ? (rootRecord["metaAnalysis"] as string)
          : "",
  };

  return plan;
}

export function serializePlanForm(plan: ResearchPlanFormState): Record<string, unknown> {
  const sections = plan.sections
    .map((section) => {
      const title = section.title.trim();
      const focus = section.focus.trim();
      const keyQuestions = section.keyQuestions
        .map((question) => question.trim())
        .filter((question) => question.length > 0);
      if (!title && !focus && keyQuestions.length === 0) {
        return null;
      }
      return {
        title,
        focus,
        key_questions: keyQuestions,
      };
    })
    .filter((section): section is { title: string; focus: string; key_questions: string[] } =>
      Boolean(section)
    );

  return {
    research_plan: {
      purpose: plan.purpose.trim(),
      sections,
      structure: {
        introduction: plan.structure.introduction.trim(),
        conclusion: plan.structure.conclusion.trim(),
      },
    },
    meta_analysis: plan.metaAnalysis.trim(),
  };
}

export function validatePlanForm(plan: ResearchPlanFormState): string | null {
  if (!plan.purpose.trim()) {
    return "調査目的を入力してください。";
  }

  const sections = plan.sections.filter((section) => {
    const hasTitle = section.title.trim().length > 0;
    const hasFocus = section.focus.trim().length > 0;
    const hasQuestions = section.keyQuestions.some((question) => question.trim().length > 0);
    return hasTitle || hasFocus || hasQuestions;
  });
  if (sections.length === 0) {
    return "少なくとも1つのセクションのタイトルと概要を入力してください。";
  }

  if (!plan.structure.introduction.trim()) {
    return "イントロダクションの概要を入力してください。";
  }

  if (!plan.structure.conclusion.trim()) {
    return "結論の概要を入力してください。";
  }

  return null;
}

export function clonePlanForm(plan: ResearchPlanFormState): ResearchPlanFormState {
  return {
    purpose: plan.purpose,
    metaAnalysis: plan.metaAnalysis,
    structure: { ...plan.structure },
    sections: plan.sections.map((section) => ({
      title: section.title,
      focus: section.focus,
      keyQuestions: [...section.keyQuestions],
    })),
  };
}
