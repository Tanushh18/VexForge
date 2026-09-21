// Where this page's contact form sends leads.
//
// The marketing site is plain static HTML with no build step, so it can't read
// environment variables — this file is the one place to configure it. Edit the
// line below and redeploy.
//
//   ""                              same origin; use when the host proxies
//                                   /api through to the API (see render.yaml)
//   "https://api.vexforge.dev"      an API on its own domain
//   "https://xyz.trycloudflare.com" a tunnel to the API on your own machine
//
// Leave it unset (delete the line) to fall back to localhost:4000 in local dev
// and same-origin everywhere else.
//
// Note on tunnels: a Cloudflare *quick* tunnel gets a new random hostname every
// restart, which means editing this file each time. A named tunnel (free, needs
// a Cloudflare account) keeps one stable hostname — worth the ten minutes if
// the form is going to stay pointed at your machine.
window.VEXFORGE_API_BASE = "";
