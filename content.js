// Enhanced content.js with improved element discovery and coordinate mapping

// Enhanced selector strategy for better coverage
const INTERACTIVE_SELECTORS = [
  // Standard interactive elements
  'button', 'a[href]', 'input', 'textarea', 'select',
  // Form elements
  'label[for]', 'fieldset', 'legend',
  // ARIA roles
  '[role="button"]', '[role="link"]', '[role="menuitem"]', '[role="tab"]', 
  '[role="option"]', '[role="checkbox"]', '[role="radio"]', '[role="textbox"]',
  '[role="combobox"]', '[role="listbox"]', '[role="tree"]', '[role="grid"]',
  // Interactive attributes
  '[onclick]', '[onsubmit]', '[contenteditable="true"]', '[contenteditable=""]',
  '[tabindex]:not([tabindex="-1"])',
  // Common UI patterns
  '.btn', '.button', '.link', '.clickable', '.interactive',
  '[data-click]', '[data-action]', '[data-href]',
  // Icons that are clickable
  'i[class*="icon"]', 'svg[class*="icon"]', '.icon',
  // Navigation and menus
  'nav a', '.nav a', '.menu a', '.dropdown a',
  // Cards and tiles
  '.card[onclick]', '.tile[onclick]', '[data-card]',
  // Custom elements
  '*[ng-click]', '*[v-on:click]', '*[@click]', '*[wire:click]'
];

// Cache for performance optimization
let domCache = {
  elements: [],
  timestamp: 0,
  cacheDuration: 2000 // 2 seconds
};

function getElementCoordinates(element) {
  const rect = element.getBoundingClientRect();
  return {
    x: Math.round(rect.left + rect.width / 2),
    y: Math.round(rect.top + rect.height / 2),
    width: Math.round(rect.width),
    height: Math.round(rect.height)
  };
}

function isElementVisible(element) {
  const style = window.getComputedStyle(element);
  const rect = element.getBoundingClientRect();
  
  return (
    style.display !== 'none' &&
    style.visibility !== 'hidden' &&
    style.opacity !== '0' &&
    rect.width > 0 &&
    rect.height > 0 &&
    rect.top < window.innerHeight &&
    rect.bottom > 0 &&
    rect.left < window.innerWidth &&
    rect.right > 0 &&
    !element.disabled &&
    !element.hasAttribute('disabled')
  );
}

function generateStableSelector(element) {
  // Priority order for stable selectors
  if (element.id) return `#${element.id}`;
  
  // Try data attributes
  const dataAttrs = ['data-testid', 'data-test', 'data-cy', 'data-automation'];
  for (const attr of dataAttrs) {
    if (element.hasAttribute(attr)) {
      return `[${attr}="${element.getAttribute(attr)}"]`;
    }
  }
  
  // Try name attribute for form elements
  if (element.name) return `[name="${element.name}"]`;
  
  // Try aria-label
  if (element.getAttribute('aria-label')) {
    return `[aria-label="${element.getAttribute('aria-label')}"]`;
  }
  
  // Try class combinations (limit to 2 most specific classes)
  if (element.className) {
    const classes = element.className.split(' ').filter(c => c.length > 2).slice(0, 2);
    if (classes.length > 0) {
      return `.${classes.join('.')}`;
    }
  }
  
  // Fall back to XPath as last resort
  return getElementXPath(element);
}

function getElementXPath(element) {
  if (element && element.id) return `//*[@id="${element.id}"]`;
  if (element === document.body) return '/html/body';

  let ix = 0;
  const siblings = element.parentNode ? element.parentNode.childNodes : [];
  for (let i = 0; i < siblings.length; i++) {
    const sibling = siblings[i];
    if (sibling === element) {
      return (
        getElementXPath(element.parentNode) +
        '/' +
        element.tagName.toLowerCase() +
        '[' +
        (ix + 1) +
        ']'
      );
    }
    if (sibling.nodeType === 1 && sibling.tagName === element.tagName) {
      ix++;
    }
  }
  return '';
}

function getElementSummary(element) {
  const tag = element.tagName.toLowerCase();
  
  // Priority order for element description
  let summary = element.getAttribute('aria-label') || 
                element.getAttribute('title') || 
                element.getAttribute('alt') ||
                element.getAttribute('placeholder') ||
                element.innerText || 
                element.textContent ||
                element.value ||
                '';

  // Special handling for different element types
  if (tag === 'input') {
    const type = element.getAttribute('type') || 'text';
    const placeholder = element.getAttribute('placeholder');
    const name = element.getAttribute('name') || element.id;
    
    if (placeholder) {
      summary = `${type} input: "${placeholder}"`;
    } else if (name) {
      summary = `${type} input field (${name})`;
    } else {
      summary = `${type} input field`;
    }
  } else if (tag === 'button') {
    if (!summary) summary = 'button';
  } else if (tag === 'a') {
    const href = element.getAttribute('href');
    if (href && !summary) summary = `link to ${href}`;
    if (!summary) summary = 'link';
  } else if (element.hasAttribute('contenteditable') && element.isContentEditable) {
    summary = 'rich text editor';
  }

  // Clean and truncate summary
  summary = summary.trim().replace(/\s+/g, ' ').substring(0, 120);
  
  // Add context from parent if summary is too generic
  if (['button', 'link', 'input'].includes(summary.toLowerCase())) {
    const parentText = element.parentNode?.textContent?.trim();
    if (parentText && parentText.length < 50) {
      summary += ` (in: ${parentText.substring(0, 30)})`;
    }
  }

  return summary || `${tag} element`;
}

function getEnhancedSemanticDOM(useCache = true) {
  // Check cache first
  const now = Date.now();
  if (useCache && domCache.timestamp && (now - domCache.timestamp < domCache.cacheDuration)) {
    return {
      ...domCache,
      cached: true
    };
  }

  // Get all potentially interactive elements using optimized query
  const allElements = [];
  
  // Use querySelector for better performance than querySelectorAll with join
  INTERACTIVE_SELECTORS.forEach(selector => {
    try {
      const elements = document.querySelectorAll(selector);
      allElements.push(...elements);
    } catch (e) {
      console.warn(`Selector failed: ${selector}`, e);
    }
  });
  
  // Remove duplicates and filter for visible elements
  const uniqueElements = [...new Set(allElements)];
  const visibleElements = uniqueElements.filter(isElementVisible);
  
  // Sort by position (top to bottom, left to right) for better UX
  const sortedElements = visibleElements.sort((a, b) => {
    const rectA = a.getBoundingClientRect();
    const rectB = b.getBoundingClientRect();
    if (Math.abs(rectA.top - rectB.top) > 10) {
      return rectA.top - rectB.top;
    }
    return rectA.left - rectB.left;
  });

  // Increased limit but with smart filtering
  const elements = sortedElements.slice(0, 300).map((el, idx) => {
    const coordinates = getElementCoordinates(el);
    const summary = getElementSummary(el);
    const selector = generateStableSelector(el);
    
    const elementData = {
      id: idx + 1,
      tag: el.tagName.toLowerCase(),
      summary: summary,
      coordinates: coordinates,
      selector: selector,
      xpath: getElementXPath(el), // Keep as fallback
      isContentEditable: el.isContentEditable,
      isVisible: true
    };

    // Add href for links
    if (el.tagName.toLowerCase() === 'a' && el.hasAttribute('href')) {
      elementData.href = el.getAttribute('href');
    }

    // Add input type for form elements
    if (el.tagName.toLowerCase() === 'input') {
      elementData.inputType = el.getAttribute('type') || 'text';
    }

    return elementData;
  });

  const result = {
    elements: elements,
    totalScanned: uniqueElements.length,
    visibleCount: visibleElements.length,
    timestamp: now,
    cached: false
  };

  // Update cache
  domCache = result;
  
  return result;
}

function findElementBySelector(selector) {
  try {
    // Try CSS selector first
    if (selector.startsWith('#') || selector.startsWith('.') || selector.startsWith('[')) {
      return document.querySelector(selector);
    }
    
    // Try XPath
    if (selector.startsWith('//') || selector.startsWith('/')) {
      const result = document.evaluate(
        selector, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null
      );
      return result.singleNodeValue;
    }
    
    return null;
  } catch (e) {
    console.error('Selector failed:', selector, e);
    return null;
  }
}

function simulateHumanInput(element, value) {
  // Focus the element
  element.focus();
  
  // Clear existing content
  if (element.isContentEditable) {
    element.innerHTML = '';
  } else {
    element.value = '';
  }
  
  // Simulate typing with events
  element.dispatchEvent(new Event('focus', { bubbles: true }));
  element.dispatchEvent(new Event('click', { bubbles: true }));
  
  if (value) {
    if (element.isContentEditable) {
      element.innerHTML = value;
      element.dispatchEvent(new Event('input', { bubbles: true }));
    } else {
      element.value = value;
      element.dispatchEvent(new Event('input', { bubbles: true }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }
  
  // Trigger validation events
  element.dispatchEvent(new Event('blur', { bubbles: true }));
}

// Debug highlighting functionality
let debugHighlights = [];

function createHighlightOverlay(coordinates, elementId) {
  const overlay = document.createElement('div');
  overlay.style.cssText = `
    position: fixed;
    left: ${coordinates.x - coordinates.width/2}px;
    top: ${coordinates.y - coordinates.height/2}px;
    width: ${coordinates.width}px;
    height: ${coordinates.height}px;
    border: 3px solid #ff6b6b;
    background: rgba(255, 107, 107, 0.1);
    pointer-events: none;
    z-index: 999999;
    border-radius: 4px;
    box-shadow: 0 0 15px rgba(255, 107, 107, 0.5);
    animation: pulse 2s infinite;
  `;
  
  // Add pulse animation
  if (!document.getElementById('debug-highlight-styles')) {
    const style = document.createElement('style');
    style.id = 'debug-highlight-styles';
    style.textContent = `
      @keyframes pulse {
        0% { opacity: 1; transform: scale(1); }
        50% { opacity: 0.7; transform: scale(1.05); }
        100% { opacity: 1; transform: scale(1); }
      }
    `;
    document.head.appendChild(style);
  }
  
  const label = document.createElement('div');
  label.textContent = `ID: ${elementId}`;
  label.style.cssText = `
    position: absolute;
    top: -25px;
    left: 0;
    background: #ff6b6b;
    color: white;
    padding: 2px 8px;
    border-radius: 4px;
    font-size: 12px;
    font-weight: bold;
    white-space: nowrap;
  `;
  
  overlay.appendChild(label);
  document.body.appendChild(overlay);
  debugHighlights.push(overlay);
  
  // Auto-remove after 5 seconds
  setTimeout(() => {
    if (overlay.parentNode) {
      overlay.parentNode.removeChild(overlay);
    }
  }, 5000);
}

function clearDebugHighlights() {
  debugHighlights.forEach(overlay => {
    if (overlay.parentNode) {
      overlay.parentNode.removeChild(overlay);
    }
  });
  debugHighlights = [];
}

// --- STATE SNAPSHOT ---
// Cheap fingerprint of page state used to verify that an action actually changed something.
function captureStateSnapshot() {
  return {
    url: window.location.href,
    elementCount: document.querySelectorAll('*').length,
    bodyTextLength: document.body.innerText.length,
    scrollY: Math.round(window.scrollY),
    activeTag: document.activeElement?.tagName || null
  };
}

// Message listener with proper async handling
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "PING") {
    sendResponse({ status: "ready" });
    return;
  }

  if (message.type === "GET_ENHANCED_DOM") {
    try {
      sendResponse(getEnhancedSemanticDOM());
    } catch (error) {
      sendResponse({ elements: [], totalScanned: 0, visibleCount: 0, error: error.message });
    }
    return;
  }

  if (message.type === "ANNOTATE_SCREENSHOT") {
    // Scale CSS pixel coordinates to screenshot physical pixels (retina/HiDPI aware)
    const dpr = window.devicePixelRatio || 1;
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);

      message.elements.forEach(el => {
        const c = el.coordinates;
        const left  = Math.round((c.x - c.width  / 2) * dpr);
        const top   = Math.round((c.y - c.height / 2) * dpr);
        const w     = Math.round(c.width  * dpr);
        const h     = Math.round(c.height * dpr);

        // Bounding box
        ctx.strokeStyle = '#ff3b30';
        ctx.lineWidth = Math.max(2, dpr);
        ctx.strokeRect(left, top, w, h);

        // ID label — above the box, or below if too close to the top edge
        const label    = String(el.id);
        const fontSize = Math.round(11 * dpr);
        ctx.font = `bold ${fontSize}px Arial`;
        const tw = ctx.measureText(label).width + Math.round(6 * dpr);
        const th = fontSize + Math.round(4 * dpr);
        const labelY   = top < th + 2 ? top + h + 2 : top - th - 2;

        ctx.fillStyle = '#ff3b30';
        ctx.fillRect(left, labelY, tw, th);
        ctx.fillStyle = 'white';
        ctx.fillText(label, left + Math.round(3 * dpr), labelY + fontSize);
      });

      sendResponse({ annotated: canvas.toDataURL('image/jpeg', 0.85) });
    };
    img.onerror = () => sendResponse({ annotated: null });
    img.src = message.screenshotDataUrl;
    return true; // async
  }

  if (message.type === "CAPTURE_STATE") {
    sendResponse(captureStateSnapshot());
    return;
  }

  if (message.type === "EXECUTE_ENHANCED_ACTION") {
    const action = message.action;
    try {
      let element = findElementBySelector(action.element.selector);
      if (!element) element = findElementBySelector(action.element.xpath);
      if (!element) {
        const coord = action.element.coordinates;
        element = document.elementFromPoint(coord.x, coord.y);
      }

      if (!element) {
        sendResponse({ status: "error", error: "Element not found with any method" });
        return;
      }

      if (action.type === "click") {
        element.scrollIntoView({ behavior: 'smooth', block: 'center' });
        setTimeout(() => {
          element.dispatchEvent(new Event('mouseover', { bubbles: true }));
          element.dispatchEvent(new Event('mousedown', { bubbles: true }));
          element.dispatchEvent(new Event('mouseup', { bubbles: true }));
          element.click();
          sendResponse({ status: "completed" });
        }, 200);
      } else if (action.type === "input") {
        simulateHumanInput(element, action.value);
        sendResponse({ status: "completed" });
      } else if (action.type === "scroll") {
        window.scrollBy(0, action.value || 300);
        sendResponse({ status: "completed" });
      } else {
        sendResponse({ status: "error", error: "Unknown action type" });
      }

    } catch (error) {
      sendResponse({ status: "error", error: error.message });
    }
    return true;
  }

  if (message.type === "HIGHLIGHT_ELEMENT") {
    createHighlightOverlay(message.coordinates, message.elementId);
    sendResponse({ status: "highlighted" });
    return;
  }

  if (message.type === "CLEAR_HIGHLIGHTS") {
    clearDebugHighlights();
    sendResponse({ status: "cleared" });
    return;
  }

  if (message.type === "SCROLL_TO_ELEMENT") {
    const coord = message.coordinates;
    window.scrollTo({ left: coord.x - window.innerWidth / 2, top: coord.y - window.innerHeight / 2, behavior: 'smooth' });
    setTimeout(() => createHighlightOverlay(coord, message.elementId), 500);
    sendResponse({ status: "scrolled" });
    return;
  }
});

console.log("Enhanced AI Agent content script loaded");