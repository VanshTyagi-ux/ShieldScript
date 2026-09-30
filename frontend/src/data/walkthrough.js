// Inputs to walk through the pipeline: a plain attack, two that only look like attacks once decoded,
// and a harmless sentence full of characters that look suspicious.
export const EXAMPLES = [
  { id: "script", label: "Script tag", text: "<script>alert(document.cookie)</script>" },
  { id: "url-encoded", label: "URL-encoded", text: "%3Cscript%3Ealert(1)%3C/script%3E" },
  { id: "entity", label: "Entity-encoded link", text: '<a href="jav&#x09;ascript:alert(1)">click</a>' },
  { id: "harmless", label: "Harmless sentence", text: "Hi, I'm Ada & I <3 math (5 < 10)." },
];

export const STEPS = [
  { id: "normalize", title: "Normalize", blurb: "Decode it the way a browser would" },
  { id: "match", title: "Match", blurb: "Run the weighted rules" },
  { id: "score", title: "Score", blurb: "Add it up and decide" },
];
