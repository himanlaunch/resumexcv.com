function textFrom(selectors) {
  for (const selector of selectors) {
    const element = document.querySelector(selector);
    const value = element?.innerText?.trim() || element?.textContent?.trim();
    if (value) return value;
  }
  return "";
}

function structuredJob() {
  for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      const raw = JSON.parse(script.textContent || "{}");
      const items = Array.isArray(raw) ? raw : raw["@graph"] || [raw];
      const job = items.find(item => item?.["@type"] === "JobPosting");
      if (job) return job;
    } catch {
      // Ignore invalid structured data and continue with visible selectors.
    }
  }
  return null;
}

function extractJob() {
  const schema = structuredJob();
  const descriptionElement = schema?.description
    ? new DOMParser().parseFromString(schema.description, "text/html").body
    : null;
  const title = schema?.title || textFrom([
    "h1", ".jobs-unified-top-card__job-title", "[data-testid='jobsearch-JobInfoHeader-title']",
    ".app-title", ".posting-headline h2", "[data-automation-id='jobPostingHeader'] h2"
  ]);
  const company = schema?.hiringOrganization?.name || textFrom([
    ".jobs-unified-top-card__company-name", "[data-company-name='true']", "[data-testid='inlineHeader-companyName']",
    ".company-name", ".posting-categories .sort-by-time", "[data-automation-id='jobPostingCompany']"
  ]);
  const jobLocation = schema?.jobLocation?.address?.addressLocality || textFrom([
    ".jobs-unified-top-card__bullet", "[data-testid='job-location']", ".location",
    ".posting-categories .location", "[data-automation-id='locations']"
  ]);
  const description = (descriptionElement?.innerText || textFrom([
    ".jobs-description__content", "#jobDescriptionText", "[data-testid='jobsearch-jobDescriptionText']",
    "#content", ".posting-page .content", "[data-automation-id='jobPostingDescription']",
    ".job-description", "main"
  ])).replace(/\s+\n/g, "\n").trim().slice(0, 18000);
  return { title, company, location: jobLocation, description, url: window.location.href, capturedAt: Date.now() };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "RESUMEX100_CAPTURE") sendResponse(extractJob());
});
