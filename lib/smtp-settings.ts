import { getSetting } from "./settings";

export interface SmtpConfig {
  host: string;
  port: number;
  user: string;
  pass: string;
  from: string;
  secure: boolean;
}

export async function getSmtpConfig(): Promise<SmtpConfig> {
  const [host, port, user, pass, from, secure] = await Promise.all([
    getSetting("smtp_host"),
    getSetting("smtp_port"),
    getSetting("smtp_user"),
    getSetting("smtp_pass"),
    getSetting("smtp_from"),
    getSetting("smtp_secure"),
  ]);

  const resolvedPort = Number.parseInt(port ?? process.env.SMTP_PORT ?? "587", 10) || 587;
  const resolvedSecure =
    secure != null ? secure === "true" : resolvedPort === 465;

  return {
    host: host ?? process.env.SMTP_HOST ?? "",
    port: resolvedPort,
    user: user ?? process.env.SMTP_USER ?? "",
    pass: pass ?? process.env.SMTP_PASS ?? "",
    from: from ?? process.env.EMAIL_FROM ?? "",
    secure: resolvedSecure,
  };
}

export function isSmtpReady(config: SmtpConfig): boolean {
  return Boolean(config.host && config.from);
}
