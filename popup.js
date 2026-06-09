const runButton = document.getElementById("run");
const promptInput = document.getElementById("prompt");
const logContainer = document.getElementById("log-container");

runButton.addEventListener("click", () => {
  const userPrompt = promptInput.value.trim();
  if (!userPrompt) {
    addLog("Please enter a prompt.", true);
    return;
  }

  logContainer.innerHTML = "";
  addLog("Starting...");
  setRunning(true);

  chrome.runtime.sendMessage({ type: "EXECUTE_TASK", prompt: userPrompt });
});

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === "UPDATE_STATUS") {
    addLog(message.text, message.isError);
    // Re-enable the button once the task finishes (success or error)
    if (message.text.startsWith("✅") || message.text.startsWith("❌")) {
      setRunning(false);
    }
  }
});

function setRunning(running) {
  runButton.disabled = running;
  runButton.textContent = running ? "Running…" : "Run";
}

function addLog(text, isError = false) {
  const entry = document.createElement("div");
  entry.className = isError ? "log-entry log-error" : "log-entry";
  entry.textContent = text;
  logContainer.appendChild(entry);
  logContainer.scrollTop = logContainer.scrollHeight;
}
