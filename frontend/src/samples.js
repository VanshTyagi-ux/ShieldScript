export const SCANNER_SAMPLES = {
  Attacks: {
    "Script tag": "<script>alert(document.cookie)</script>",
    "Event handler": "<img src=x onerror=alert(1)>",
    "SVG onload": "<svg/onload=alert(1)>",
    "JS URI": '<a href="jav&#x09;ascript:alert(1)">click</a>',
    "URL-encoded": "%3Cscript%3Ealert(1)%3C/script%3E",
    "Attr breakout": "\"><script>alert(1)</script>",
    "Template": "{{constructor.constructor('alert(1)')()}}",
  },
  Harmless: {
    "Plain text": "Hi, I'm Ada & I <3 math (5 < 10).",
    "Code-ish": "if (a < b && c > d) { total = a + b; }",
  },
};

export const FORM_SAMPLES = {
  clean: { name: "Ada Lovelace", email: "ada@example.com", website: "https://example.com", comment: "Great post, thanks! 5 < 10." },
  attack: { name: "Mallory", email: "not-an-email", website: "javascript:alert(1)", comment: "<img src=x onerror=alert(1)>" },
};
