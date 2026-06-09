// Default model — must be in OpenRouter format: "provider/model-name"
// Vision capability required. See https://openrouter.ai/models for available IDs.
// Override this in the extension's Options page without touching code.
let OPENROUTER_MODEL = "anthropic/claude-3-5-sonnet";

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "EXECUTE_TASK") {
    orchestrateTask(message.prompt);
    return true;
  }
});

async function orchestrateTask(originalPrompt) {
  const MAX_STEPS = 10;
  const actionHistory = [];
  let failureStreak = 0;

  try {
    const { OPENROUTER_API_KEY, OPENROUTER_MODEL: savedModel } = await chrome.storage.sync.get(['OPENROUTER_API_KEY', 'OPENROUTER_MODEL']);
    if (!OPENROUTER_API_KEY) throw new Error("API Key not found. Please configure in options.");
    if (savedModel) OPENROUTER_MODEL = savedModel;

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) throw new Error("No active tab found.");
    await ensureContentScriptLoaded(tab.id);

    for (let step = 1; step <= MAX_STEPS; step++) {
      updateStatus(`Step ${step}/${MAX_STEPS}: Capturing visual state...`, false);
      const screenshotDataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "jpeg", quality: 85 });

      // --- STAGE 1: Visual identification (screenshot only, no DOM noise) ---
      updateStatus(`Step ${step}/${MAX_STEPS}: Visual analysis...`, false);
      const visual = await callVisualLlm(originalPrompt, screenshotDataUrl, actionHistory, OPENROUTER_API_KEY);

      if (visual.isComplete) {
        updateStatus("✅ Task completed successfully!", false);
        return;
      }

      if (visual.targetX == null || visual.targetY == null) {
        throw new Error("Visual analysis could not identify a target on screen.");
      }

      // --- STAGE 2: DOM resolution ---
      updateStatus(`Step ${step}/${MAX_STEPS}: Resolving target element...`, false);
      const domData = await getDOMDataWithRetry(tab.id, 3);

      const nearbyElements = domData.elements.filter(el => {
        const dx = el.coordinates.x - visual.targetX;
        const dy = el.coordinates.y - visual.targetY;
        return Math.sqrt(dx * dx + dy * dy) < 150;
      });

      let resolvedElement;

      if (nearbyElements.length === 1) {
        // Unambiguous — one element in range, use it directly
        resolvedElement = nearbyElements[0];
      } else if (nearbyElements.length === 0) {
        // Nothing nearby — global nearest as fallback
        resolvedElement = findNearestInList(visual.targetX, visual.targetY, domData.elements);
      } else {
        // Multiple candidates or low confidence — annotate and let model pick by ID
        const label = visual.confidence < 60
          ? `Low confidence (${visual.confidence}%), annotating candidates...`
          : `${nearbyElements.length} candidates near target, annotating...`;
        updateStatus(`Step ${step}/${MAX_STEPS}: ${label}`, false);

        const annotatedUrl = await annotateScreenshot(tab.id, screenshotDataUrl, nearbyElements);
        const refined = await callRefinedLlm(
          originalPrompt, annotatedUrl || screenshotDataUrl, nearbyElements, visual, actionHistory, OPENROUTER_API_KEY
        );
        resolvedElement = domData.elements.find(el => el.id === refined.elementId)
          || findNearestInList(visual.targetX, visual.targetY, domData.elements);
      }

      if (!resolvedElement) throw new Error("Could not resolve a DOM element for the visual target.");

      const actionType = visual.actionType || inferActionType(resolvedElement);
      const actionValue = visual.inputValue || null;

      updateStatus(`Step ${step}/${MAX_STEPS}: ${visual.reasoning}`, false);

      // --- PRE-ACTION SNAPSHOT ---
      const preState = await captureTabState(tab.id);

      const executionResult = await executeActionWithRetry(tab.id, {
        type: actionType,
        elementId: resolvedElement.id,
        value: actionValue
      }, resolvedElement);

      if (!executionResult.success) {
        throw new Error(`Action failed: ${executionResult.error}`);
      }

      await new Promise(resolve => setTimeout(resolve, 1500));

      // --- POST-ACTION VERIFICATION ---
      const postState = await captureTabState(tab.id);
      const didChange = stateChanged(preState, postState);

      const actionSummary = `Step ${step}: ${actionType} on "${resolvedElement.summary}" at (${resolvedElement.coordinates.x},${resolvedElement.coordinates.y}) [${didChange ? 'change detected' : 'NO CHANGE'}]`;
      actionHistory.push(actionSummary);

      if (!didChange && actionType !== 'scroll') {
        failureStreak++;
        updateStatus(`Step ${step}/${MAX_STEPS}: Action may not have registered (streak: ${failureStreak})`, false);
        if (failureStreak >= 3) {
          throw new Error("Agent is stuck — 3 consecutive actions produced no page change.");
        }
      } else {
        failureStreak = 0;
      }
    }

    throw new Error("Agent could not complete the task within the maximum number of steps.");

  } catch (error) {
    console.error("Orchestration failed:", error);
    updateStatus(`❌ Error: ${error.message}`, true);
  }
}

// Stage 1: pure visual identification — screenshot only, no DOM list sent to the model.
// The model's only job here is to say WHERE on screen to interact.
async function callVisualLlm(prompt, screenshotDataUrl, history, apiKey) {
  const formattedHistory = history.length > 0
    ? `Actions taken so far:\n${history.map(h => `- ${h}`).join('\n')}`
    : "This is the first action.";

  const systemPrompt = `You are a visual web agent. Your only job right now is to identify WHERE on screen to interact to make progress toward the user's goal.

Do NOT try to identify exact element IDs or CSS selectors — just approximate screen coordinates. The system will resolve the exact element programmatically.

Look at the screenshot carefully. If you see a step that was previously attempted with "NO CHANGE", try a different target or approach.

RETURN JSON only:
{
  "reasoning": "what you see and why you're targeting this location",
  "targetX": <integer pixel x>,
  "targetY": <integer pixel y>,
  "actionType": "click" | "input" | "scroll",
  "inputValue": "<text to type if actionType is input, else null>",
  "isComplete": false,
  "confidence": <0-100>
}

Set isComplete to true only if the full goal is already accomplished on screen.`;

  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: OPENROUTER_MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        {
          role: "user", content: [
            { type: "text", text: `GOAL: "${prompt}"\n\n${formattedHistory}\n\nIdentify your target:` },
            { type: "image_url", image_url: { url: screenshotDataUrl } }
          ]
        }
      ],
      response_format: { type: "json_object" },
      temperature: 0.1,
    })
  });

  if (!response.ok) {
    const err = await response.json();
    throw new Error(`Visual LLM failed: ${response.status} - ${JSON.stringify(err)}`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error("Visual LLM returned empty content.");

  try {
    return JSON.parse(content);
  } catch (e) {
    throw new Error("Visual LLM returned malformed JSON.");
  }
}

// Sends the screenshot to content.js for canvas annotation, returns an annotated data URL.
// Annotates only the provided elements so the model sees a focused, uncluttered view.
async function annotateScreenshot(tabId, screenshotDataUrl, elements) {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => resolve(null), 6000);
    chrome.tabs.sendMessage(tabId, { type: "ANNOTATE_SCREENSHOT", screenshotDataUrl, elements }, (response) => {
      clearTimeout(timeout);
      if (chrome.runtime.lastError || !response) resolve(null);
      else resolve(response.annotated || null);
    });
  });
}

// Stage 2 refinement: called when multiple candidates exist near the visual target,
// or when stage 1 confidence is low. The screenshot passed in is already annotated
// with red numbered boxes matching the element IDs in nearbyElements.
async function callRefinedLlm(prompt, screenshotDataUrl, nearbyElements, visualResult, history, apiKey) {
  const elementList = nearbyElements
    .map(el => `ID ${el.id}: "${el.summary}" [${el.tag}]`)
    .join('\n');

  const systemPrompt = `You are resolving a precise interaction target. The screenshot has red numbered boxes drawn on it — each box is labeled with an element ID.

Visual analysis pointed near (${visualResult.targetX}, ${visualResult.targetY}). Identify which numbered box best matches the goal, then return that element's ID.

Available elements (IDs match the red box labels in the image):
${elementList}

RETURN JSON only:
{
  "elementId": <number matching a red box label>,
  "reasoning": "why this box"
}`;

  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: OPENROUTER_MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        {
          role: "user", content: [
            { type: "text", text: `GOAL: "${prompt}"\n\nWhich numbered box should I interact with?` },
            { type: "image_url", image_url: { url: screenshotDataUrl } }
          ]
        }
      ],
      response_format: { type: "json_object" },
      temperature: 0.1,
    })
  });

  if (!response.ok) return {};

  const data = await response.json();
  try {
    return JSON.parse(data.choices?.[0]?.message?.content || '{}');
  } catch (e) {
    return {};
  }
}

// Programmatic nearest-element resolution — no LLM involved.
// Operates on the already-fetched element list so we avoid an extra round-trip.
function findNearestInList(targetX, targetY, elements) {
  if (!elements || elements.length === 0) return null;

  let nearest = null;
  let minDist = Infinity;

  for (const el of elements) {
    const dx = el.coordinates.x - targetX;
    const dy = el.coordinates.y - targetY;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < minDist) {
      minDist = dist;
      nearest = el;
    }
  }

  return nearest;
}

function inferActionType(element) {
  const interactiveInputTypes = ['text', 'email', 'password', 'search', 'tel', 'url', 'number'];
  if (element.tag === 'textarea') return 'input';
  if (element.isContentEditable) return 'input';
  if (element.tag === 'input' && interactiveInputTypes.includes(element.inputType)) return 'input';
  return 'click';
}

async function captureTabState(tabId) {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => resolve(null), 3000);
    chrome.tabs.sendMessage(tabId, { type: "CAPTURE_STATE" }, (response) => {
      clearTimeout(timeout);
      if (chrome.runtime.lastError || !response) resolve(null);
      else resolve(response);
    });
  });
}

function stateChanged(before, after) {
  if (!before || !after) return true; // assume changed if we can't measure
  return (
    before.url !== after.url ||
    Math.abs(before.elementCount - after.elementCount) > 2 ||
    Math.abs(before.bodyTextLength - after.bodyTextLength) > 10 ||
    before.scrollY !== after.scrollY
  );
}

async function ensureContentScriptLoaded(tabId) {
  try {
    const response = await chrome.tabs.sendMessage(tabId, { type: "PING" });
    if (response && response.status === "ready") return true;
  } catch (e) {
    console.log("Content script not loaded, injecting...");
  }

  await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
  await new Promise(resolve => setTimeout(resolve, 1000));

  const response = await chrome.tabs.sendMessage(tabId, { type: "PING" });
  if (!response || response.status !== "ready") {
    throw new Error("Content script failed to initialize after injection.");
  }

  return true;
}

async function getDOMDataWithRetry(tabId, maxRetries = 3) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const domData = await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error("DOM data request timeout")), 10000);
        chrome.tabs.sendMessage(tabId, { type: "GET_ENHANCED_DOM" }, (response) => {
          clearTimeout(timeout);
          if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
          else if (response && response.error) reject(new Error(response.error));
          else resolve(response);
        });
      });

      if (domData && domData.elements && domData.elements.length > 0) return domData;
      throw new Error("Empty DOM data received");

    } catch (error) {
      console.warn(`DOM data attempt ${attempt} failed:`, error.message);
      if (attempt === maxRetries) throw error;
      await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
      if (attempt === maxRetries - 1) {
        try { await ensureContentScriptLoaded(tabId); } catch (e) { /* best effort */ }
      }
    }
  }
}

async function executeActionWithRetry(tabId, action, domElement, maxRetries = 2) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const result = await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error("Action execution timeout")), 5000);
        chrome.tabs.sendMessage(tabId, {
          type: "EXECUTE_ENHANCED_ACTION",
          action: { ...action, element: domElement }
        }, (response) => {
          clearTimeout(timeout);
          if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
          else resolve(response);
        });
      });

      if (result.status === "completed") return { success: true };
      if (result.status === "error") {
        if (attempt === maxRetries) return { success: false, error: result.error };
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    } catch (error) {
      if (attempt === maxRetries) return { success: false, error: error.message };
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }
  return { success: false, error: "Max retries exceeded" };
}

function updateStatus(text, isError = false) {
  chrome.runtime.sendMessage({ type: "UPDATE_STATUS", text, isError });
}
