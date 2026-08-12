export const ALL_SHIRT_SIZES: string[] = ["PP", "P", "M", "G", "GG", "XGG"];

export interface ShirtSizeRestrictionInput {
  shirtSizeRestrictionDate: Date | null;
  shirtSizeRestrictionSizes: string[];
}

export function getAllowedShirtSizes(event: ShirtSizeRestrictionInput, now: Date = new Date()): string[] {
  if (!event.shirtSizeRestrictionDate || now < event.shirtSizeRestrictionDate) {
    return ALL_SHIRT_SIZES;
  }
  return event.shirtSizeRestrictionSizes.length > 0 ? event.shirtSizeRestrictionSizes : ALL_SHIRT_SIZES;
}
