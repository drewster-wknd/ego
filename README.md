# ego
...is a Chrome extension that executes plain-English instructions on any webpage by combining AI vision with live DOM analysis.

**How it works**

Most browser automation agents use either a pure screenshot approach (imprecise — models hallucinate pixel coordinates) or a pure DOM/accessibility tree approach (blind to visual context). This extension uses a two-stage hybrid:

1. **Visual identification** — a clean screenshot is sent to a vision-capable LLM. The model's only job is to identify *where* on screen to interact, returning approximate coordinates. No DOM data is sent at this stage, keeping the visual reasoning uncluttered.

2. **DOM resolution** — the extension scans the live DOM for interactive elements and finds those within range of the model's target coordinates. If multiple candidates exist or confidence is low, it draws red numbered boxes (set-of-mark annotation) directly onto the screenshot — scaled for HiDPI/retina displays — and asks the model to pick by the ID it can see in the image. This separates visual reasoning from precise element targeting.

3. **Execution & verification** — the resolved element is interacted with via realistic event simulation. Before and after snapshots (URL, element count, scroll position, body text length) are compared to confirm something actually changed. Three consecutive no-change actions trigger an abort rather than an infinite loop.

**What makes this approach distinct**

- Runs inside the user's live authenticated browser session — no headless browser, no re-authentication, works on any page the user can already see including internal tools, paywalled content, and localhost
- The set-of-mark annotation only marks nearby candidates, not all 300 scanned elements, keeping the annotated image readable
- Action history passed to each step includes a `[NO CHANGE]` flag on failed actions so the model can adapt rather than repeat the same mistake
- Model and API key are configured via the Options page and stored in `chrome.storage.sync` — no credentials in source

**Stack**

- Chrome Extension Manifest V3
- OpenRouter API (bring your own key — any vision-capable model works, e.g. `anthropic/claude-3-5-sonnet`)
- Vanilla JS, no build step

**Installation**

1. Clone the repo
2. Go to `chrome://extensions`, enable Developer Mode, click Load Unpacked, select the folder
3. Open the extension Options page, paste your OpenRouter API key and model ID
4. Navigate to any page, open the popup, describe what to do, hit Run
