export interface SocialNetworkDefinition {
  key: string;
  label: string;
}

export const SOCIAL_NETWORKS: SocialNetworkDefinition[] = [
  { key: "social_instagram", label: "Instagram" },
  { key: "social_facebook", label: "Facebook" },
  { key: "social_whatsapp", label: "WhatsApp" },
  { key: "social_youtube", label: "YouTube" },
  { key: "social_tiktok", label: "TikTok" },
  { key: "social_x", label: "X" },
];

export const SOCIAL_NETWORK_KEYS: string[] = SOCIAL_NETWORKS.map((n) => n.key);

export interface SocialLink {
  key: string;
  label: string;
  url: string;
}

/** Retorna só as redes com valor preenchido (não vazio/whitespace), na ordem de SOCIAL_NETWORKS. */
export function buildSocialLinks(values: Record<string, string | null | undefined>): SocialLink[] {
  const result: SocialLink[] = [];
  for (const network of SOCIAL_NETWORKS) {
    const raw = values[network.key];
    const trimmed = raw?.trim();
    if (trimmed) {
      result.push({ key: network.key, label: network.label, url: trimmed });
    }
  }
  return result;
}
