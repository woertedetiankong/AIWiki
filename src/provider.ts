export interface GenerateTextInput {
  system?: string;
  prompt: string;
  temperature?: number;
  maxTokens?: number;
}

export interface LLMProvider {
  generateText(input: GenerateTextInput): Promise<string>;
}
