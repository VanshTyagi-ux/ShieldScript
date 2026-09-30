export const LEVEL_LABEL = {
  safe: "Safe", low: "Low risk", medium: "Medium risk", high: "High risk", critical: "Critical risk",
};

export function verdictText(result) {
  return result.is_malicious ? "Potential XSS - would be blocked" : "Looks acceptable";
}

export function announcementFor(result) {
  return `${LEVEL_LABEL[result.level] || result.level}, score ${result.score} of 100. ${verdictText(result)}.`;
}
