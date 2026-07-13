import dns from "node:dns";

const MX_LOOKUP_TIMEOUT_MS = 4000;

export async function hasValidMxRecord(email: string): Promise<boolean> {
  const domain = email.split("@")[1];
  if (!domain) return false;

  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        resolve(true);
      }
    }, MX_LOOKUP_TIMEOUT_MS);

    dns.resolveMx(domain, (err, addresses) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (err) {
        resolve(err.code === "ENOTFOUND" || err.code === "ENODATA" ? false : true);
      } else {
        resolve(addresses.length > 0);
      }
    });
  });
}
