// Where the API lives.
//
// Default is the relative "/api", which covers local dev (Vite proxies it to
// :4000) and any host that proxies /api through to the server.
//
// Set VITE_API_BASE_URL to point the console at an API on a different origin —
// a Cloudflare tunnel to the API running on your own machine, for instance.
// Vite inlines this at BUILD time, not runtime: a static site has no server to
// read env vars from, so changing it means rebuilding, not just restarting.
// On Render, set it on the static site and trigger a redeploy.
const API_ORIGIN = (import.meta.env.VITE_API_BASE_URL || "").trim().replace(/\/+$/, "");
const BASE = API_ORIGIN ? `${API_ORIGIN}/api` : "/api";

function authHeaders() {
  const token = localStorage.getItem("vf_token");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function request(path, { method = "GET", body } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

export const api = {
  login: (email, password) => request("/auth/login", { method: "POST", body: { email, password } }),

  orgTree: () => request("/employees/tree"),
  employees: (department) => request(`/employees${department ? `?department=${department}` : ""}`),

  leads: (stage) => request(`/leads${stage ? `?stage=${stage}` : ""}`),
  createLead: (body) => request("/leads", { method: "POST", body }),
  updateLead: (id, body) => request(`/leads/${id}`, { method: "PATCH", body }),
  deleteLead: (id) => request(`/leads/${id}`, { method: "DELETE" }),
  scrapeLead: (body) => request("/leads/scrape", { method: "POST", body }),
  importLeadsCsv: (csv) => request("/leads/import-csv", { method: "POST", body: { csv } }),

  outreach: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return request(`/outreach${qs ? `?${qs}` : ""}`);
  },
  outreachConfig: () => request("/outreach/config"),
  generateOutreach: (body) => request("/outreach/generate", { method: "POST", body }),
  createOutreach: (body) => request("/outreach", { method: "POST", body }),
  updateOutreach: (id, body) => request(`/outreach/${id}`, { method: "PATCH", body }),
  approveOutreach: (id) => request(`/outreach/${id}/approve`, { method: "POST" }),
  rejectOutreach: (id, reason) => request(`/outreach/${id}/reject`, { method: "POST", body: { reason } }),
  sendOutreachEmail: (id) => request(`/outreach/${id}/send-email`, { method: "POST" }),
  markOutreachSent: (id) => request(`/outreach/${id}/mark-sent`, { method: "POST" }),

  tickets: (status) => request(`/tickets${status ? `?status=${status}` : ""}`),
  createTicket: (body) => request("/tickets", { method: "POST", body }),
  updateTicket: (id, body) => request(`/tickets/${id}`, { method: "PATCH", body }),

  activity: (limit = 50) => request(`/activity?limit=${limit}`),

  chatConfig: () => request("/chat/config"),
  chatHistory: () => request("/chat/history"),
  sendChat: (message, history) => request("/chat", { method: "POST", body: { message, history } }),

  scrapeJobs: () => request("/admin/scrape-jobs"),
  scrapeJob: (id) => request(`/admin/scrape-jobs/${id}`),
  createScrapeJob: (body) => request("/admin/scrape-jobs", { method: "POST", body }),

  models: () => request("/admin/models"),
  settings: () => request("/admin/settings"),
  updateSettings: (body) => request("/admin/settings", { method: "PATCH", body }),
  jobs: () => request("/admin/jobs"),
  runJob: (key) => request(`/admin/jobs/${key}/run`, { method: "POST" }),

  pipelineSources: () => request("/pipeline/sources"),
  pipelineStatus: () => request("/pipeline/status"),
  pipelineRuns: () => request("/pipeline/runs"),
  runPipeline: (body) => request("/pipeline/run", { method: "POST", body }),
  rescoreLeads: (useModel = true) => request("/leads/rescore", { method: "POST", body: { useModel } }),

  digestLatest: () => request("/digest/latest"),
};
