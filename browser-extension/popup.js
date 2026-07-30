const button = document.getElementById("save");
const message = document.getElementById("message");

function encodeCapture(value) {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

button.addEventListener("click", async () => {
  button.disabled = true;
  message.textContent = "Reading the job posting…";
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const job = await chrome.tabs.sendMessage(tab.id, { type: "RESUMEX100_CAPTURE" });
    if (!job?.title || !job?.description) throw new Error("Job details were not found");
    const target = `https://resumex100.com/app?capture=${encodeCapture(job)}`;
    await chrome.tabs.create({ url: target });
    window.close();
  } catch (error) {
    message.textContent = "We couldn’t read this page. Open the full job posting and try again, or paste its URL in ResumeX100.";
    button.disabled = false;
  }
});
