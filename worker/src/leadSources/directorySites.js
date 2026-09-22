import { makeDirectorySource } from "./genericDirectory.js";

// Fifteen listing/launch/directory sites, all run through the generic
// harvester in genericDirectory.js rather than bespoke per-site scrapers.
//
// HONESTY NOTE: this sandbox has no outbound network access, so none of these
// URLs or the pages behind them could be checked against the live site while
// writing this file. Each config is my best knowledge of a real, public
// listing page for each platform. Because the harvester works by extracting
// *any* outbound link + its text (not a site-specific CSS class), it tolerates
// markup changes far better than a bespoke scraper would — but a site that's
// moved its listing to a different path, added a login wall, or renders
// nothing without JS interaction (infinite scroll with no initial content)
// will come back with 0 results rather than throwing, thanks to safeSource()
// isolating each source's failures from the rest of the run.
//
// Run the worker locally and check the Lead Pipeline page's per-source result
// counts after a real run — that tells you exactly which of these are
// actually working today and which need their `url` or `waitForSelector`
// adjusted. That fix is always a one-line config change here, never a rewrite.

const CONFIGS = [
  {
    key: "betalist",
    label: "BetaList — startups launching",
    url: "https://betalist.com/",
    platformHosts: ["betalist.com"],
    signals: ["just_launched"],
  },
  {
    key: "betapage",
    label: "BetaPage — startup launches",
    url: "https://betapage.co/",
    platformHosts: ["betapage.co"],
    signals: ["just_launched"],
  },
  {
    key: "indiehackers_products",
    label: "Indie Hackers — products",
    url: "https://www.indiehackers.com/products",
    platformHosts: ["indiehackers.com"],
    signals: ["just_launched"],
  },
  {
    key: "saashub",
    label: "SaaSHub — newest SaaS tools",
    url: "https://www.saashub.com/best/newest",
    platformHosts: ["saashub.com"],
    signals: ["just_launched"],
  },
  {
    key: "f6s",
    label: "F6S — startup directory",
    url: "https://www.f6s.com/companies",
    platformHosts: ["f6s.com"],
    signals: ["just_launched"],
  },
  {
    key: "startupranking",
    label: "StartupRanking — newest startups",
    url: "https://www.startupranking.com/newest",
    platformHosts: ["startupranking.com"],
    signals: ["just_launched"],
  },
  {
    key: "launchingnext",
    label: "Launching Next — new startups",
    url: "https://www.launchingnext.com/",
    platformHosts: ["launchingnext.com"],
    signals: ["just_launched"],
  },
  {
    key: "devhunt",
    label: "DevHunt — developer tool launches",
    url: "https://devhunt.org/",
    platformHosts: ["devhunt.org"],
    signals: ["just_launched"],
  },
  {
    key: "peerlist_launches",
    label: "Peerlist — project launches",
    url: "https://peerlist.io/launches",
    platformHosts: ["peerlist.io"],
    signals: ["just_launched"],
  },
  {
    key: "wellfound_startups",
    label: "Wellfound — startup listings",
    url: "https://wellfound.com/startups",
    platformHosts: ["wellfound.com", "angel.co"],
    // A listing here implies active hiring/fundraising infrastructure, not a
    // confirmed launch date — different signal from the launch-board sources.
    signals: ["hiring"],
  },
  {
    key: "libhunt",
    label: "LibHunt — trending open-source projects",
    url: "https://www.libhunt.com/",
    platformHosts: ["libhunt.com"],
    signals: ["just_launched"],
  },
  {
    key: "openalternative",
    label: "OpenAlternative — new open-source tools",
    url: "https://openalternative.co/",
    platformHosts: ["openalternative.co"],
    signals: ["just_launched"],
  },
  {
    key: "alternativeto_new",
    label: "AlternativeTo — recently added",
    url: "https://alternativeto.net/recently-added/",
    platformHosts: ["alternativeto.net"],
    signals: ["just_launched"],
  },
  {
    key: "uneed",
    label: "Uneed — new tools launching",
    url: "https://www.uneed.best/",
    platformHosts: ["uneed.best"],
    signals: ["just_launched"],
  },
  {
    key: "microlaunch",
    label: "Microlaunch — micro-SaaS launches",
    url: "https://microlaunch.net/",
    platformHosts: ["microlaunch.net"],
    signals: ["just_launched"],
  },
];

export const DIRECTORY_SOURCES = CONFIGS.map(makeDirectorySource);

export default DIRECTORY_SOURCES;
