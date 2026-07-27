export interface AiTextProvider {
  generateText(prompt: string): Promise<string>;
}
