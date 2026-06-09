const saveButton = document.getElementById('save');
const apiKeyInput = document.getElementById('apiKey');
const modelIdInput = document.getElementById('modelId');
const statusDiv = document.getElementById('status');

document.addEventListener('DOMContentLoaded', () => {
  chrome.storage.sync.get(['OPENROUTER_API_KEY', 'OPENROUTER_MODEL'], (result) => {
    if (result.OPENROUTER_API_KEY) apiKeyInput.value = result.OPENROUTER_API_KEY;
    if (result.OPENROUTER_MODEL) modelIdInput.value = result.OPENROUTER_MODEL;
  });
});

saveButton.addEventListener('click', () => {
  const apiKey = apiKeyInput.value.trim();
  const modelId = modelIdInput.value.trim();

  if (!apiKey) {
    statusDiv.textContent = 'Please enter an API key.';
    statusDiv.style.color = 'red';
    return;
  }

  chrome.storage.sync.set({ OPENROUTER_API_KEY: apiKey, OPENROUTER_MODEL: modelId || null }, () => {
    statusDiv.textContent = 'Settings saved.';
    statusDiv.style.color = 'green';
    setTimeout(() => { statusDiv.textContent = ''; }, 3000);
  });
});
