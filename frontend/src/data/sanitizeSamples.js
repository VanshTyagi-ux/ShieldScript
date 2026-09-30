// Inputs for the sanitizer playground. The first is what the page starts with.
export const DEFAULT_SANITIZE_SAMPLE =
  '<p onclick="steal()">Hi <b>there</b>, <a href="javascript:alert(1)">click me</a><script>alert(document.cookie)</script></p><!-- note -->';

export const SANITIZE_SAMPLES = {
  "Should pass": {
    "Formatting": '<h2>Release notes</h2><p>Some <b>bold</b>, <i>italic</i> and <code>code</code>, with a <a href="https://example.com" title="Example">link</a>.</p><ul><li>one</li><li>two</li></ul>',
    "Image": '<p><img src="https://example.com/cat.png" alt="A cat"></p>',
  },
  "Should be cleaned": {
    "Script tag": "<p>Hello</p><script>alert(document.cookie)</script>",
    "Event handler": '<img src="x.png" alt="pic" onerror="alert(1)">',
    "javascript: link": '<a href="javascript:alert(1)">click me</a>',
    "Style and class": '<p style="position:fixed;top:0" class="banner">covers the page</p>',
    "Embeds": '<iframe src="https://evil.example"></iframe><object data="x"></object><svg onload="alert(1)"></svg>',
    "Comment": "<!-- secret --><p>visible</p>",
    "Nested trick": '<noscript><p title="</noscript><img src=x onerror=alert(1)>">',
  },
};
