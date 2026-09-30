# XSS detector benchmark

Held-out test split: **2640** malicious payloads (SecLists public XSS lists), **4948** benign inputs (Python docs text + synthetic form input), **49** hand-written hard negatives (never used for training).

| Detector | Recall | Precision | F1 | False-positive rate | Hard-negative FPs | TP | FN | FP | TN |
|---|---|---|---|---|---|---|---|---|---|
| Rules | 94.2% | 100.0% | 97.0% | 0.00% | 1/49 | 2488 | 152 | 0 | 4948 |
| ML alone | 99.9% | 99.8% | 99.8% | 0.10% | 2/49 | 2637 | 3 | 5 | 4943 |
| Naive hybrid (rules OR ML) | 99.9% | 99.8% | 99.8% | 0.10% | 3/49 | 2637 | 3 | 5 | 4943 |
| Hybrid (rules; ML escalates) | 95.2% | 100.0% | 97.5% | 0.00% | 1/49 | 2512 | 128 | 0 | 4948 |

## Rules: sample of missed payloads (false negatives)
- `<br><br><br><br><br><br><br><br><br><br>`
- `<br><br><br><br><br><br><x id=x>#x`
- `a=alert,a(1)`
- `[1].find(alert)`
- `top['al\145rt'](1)`
- `navigator.vibrate(500)`
- `"'%u3e%u3cscript%u3econfirm(42)%u3c/script%u3e`
- `%u22%u27%u3e%u3cscript%u3econfirm(42)%u3c/script%u3e`
- `jAvas\Cript:confirm(42)`
- `document.`
- `top.`
- `top[`

### Rules: false positives on benign text
- (none)

### Rules: false positives on hard negatives
- `onset = 3 days after symptoms`

## ML alone: sample of missed payloads (false negatives)
- `navigator.vibrate(500)`
- `top.`
- `On Mouse Over​`

### ML alone: false positives on benign text
- `'left<<<<<<<<<<<<'`
- `<enum 'Menu'>`
- `'Hook'`
- `d[key]`
- `Overview`

### ML alone: false positives on hard negatives
- `C:\users\public\documents`
- `<3 <3 <3`

## Naive hybrid (rules OR ML): sample of missed payloads (false negatives)
- `navigator.vibrate(500)`
- `top.`
- `On Mouse Over​`

### Naive hybrid (rules OR ML): false positives on benign text
- `'left<<<<<<<<<<<<'`
- `<enum 'Menu'>`
- `'Hook'`
- `d[key]`
- `Overview`

### Naive hybrid (rules OR ML): false positives on hard negatives
- `C:\users\public\documents`
- `onset = 3 days after symptoms`
- `<3 <3 <3`

## Hybrid (rules; ML escalates): sample of missed payloads (false negatives)
- `<br><br><br><br><br><br><br><br><br><br>`
- `<br><br><br><br><br><br><x id=x>#x`
- `top['al\145rt'](1)`
- `navigator.vibrate(500)`
- `"'%u3e%u3cscript%u3econfirm(42)%u3c/script%u3e`
- `%u22%u27%u3e%u3cscript%u3econfirm(42)%u3c/script%u3e`
- `document.`
- `top.`
- `top[`
- `eval(`
- `onload`
- `"onerror`

### Hybrid (rules; ML escalates): false positives on benign text
- (none)

### Hybrid (rules; ML escalates): false positives on hard negatives
- `onset = 3 days after symptoms`

> **Notes**
> - Many lines in public payload lists are fragments (e.g. `</scrip</scr`, `href=`, `top.`) rather than working attacks, so recall below 100% is expected, especially for the rule engine.
> - The ML model's benign training text is mostly English prose and code from the Python docs, so it partly learns "looks like markup/code" versus "looks like prose". Treat its false-positive rate as optimistic for real-world input such as rich-text comments; the hard-negative column is the harsher check.
> - The random-split numbers are optimistic (near-duplicate payloads leak across the split); the unseen-source table below is the fairer estimate.

## Unseen-source test (leave-one-list-out)

The ML model is retrained without one payload list and scored on that list only.

| Held-out list | Payloads | Rules recall | ML recall (unseen) | ML false-positive rate |
|---|---|---|---|---|
| XSS-BruteLogic.txt | 113 | 94.7% | 100.0% | 0.14% |
| XSS-Cheat-Sheet-PortSwigger.txt | 6042 | 100.0% | 100.0% | 0.20% |
| XSS-EnDe-evation.txt | 161 | 56.5% | 78.9% | 0.06% |
| XSS-EnDe-h4k.txt | 204 | 62.3% | 93.1% | 0.04% |
| XSS-innerht-ml.txt | 48 | 100.0% | 100.0% | 0.10% |
| XSS-Jhaddix.txt | 107 | 100.0% | 100.0% | 0.10% |
| XSS-OFJAAAH.txt | 1616 | 84.3% | 99.4% | 0.10% |
| XSS-Vectors-Mario.txt | 134 | 87.3% | 100.0% | 0.14% |
| **Weighted average** | 8425 | 95.0% | 99.3% | |
