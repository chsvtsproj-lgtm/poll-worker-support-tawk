// Poll Worker Support (tawk) - front-end configuration. No secrets belong here (the repo is public).
// Paste the Web app URL of the Apps Script project "Poll Worker Support (tawk)" between the quotes.
// It looks like https://script.google.com/macros/s/AKfy.../exec
window.API_URL = "https://script.google.com/macros/s/AKfycbzNy6nQVeV_1jTDuxm50-0QU28IWU3jQijuqEhe2S3RbGDXpTLVUC3jNXDeVrWbRvPK5A/exec";
// Optional Cloudflare Worker relay (poll-worker-relay-tawk) for networks that block Google script addresses.
// It looks like https://poll-worker-relay-tawk.chsvotes-support.workers.dev
// When set, the pages use ONLY this URL (no fallback to API_URL). Leave empty to use API_URL.
// The relay origin must also be listed in connect-src in index.html and admin/index.html
// (tools/configure.sh does all of this).
window.RELAY_URL = "https://poll-worker-relay-tawk.chsvotes-support.workers.dev";
