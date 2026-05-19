export type Questionnaire = {
  gender?: "homme" | "femme" | "autre";
  looking_for?: "femme" | "homme" | "les_deux";
  age_min?: number;
  age_max?: number;
  styles_liked?: string[];
  vibe?: string;
  dress_style?: string;
  scenes?: string[];
  city?: string;
};

const KEY = "matchshot.questionnaire";

export function loadQuestionnaire(): Questionnaire {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(sessionStorage.getItem(KEY) || "{}");
  } catch {
    return {};
  }
}

export function saveQuestionnaire(q: Questionnaire) {
  if (typeof window === "undefined") return;
  sessionStorage.setItem(KEY, JSON.stringify(q));
}

export function clearQuestionnaire() {
  if (typeof window === "undefined") return;
  sessionStorage.removeItem(KEY);
}
