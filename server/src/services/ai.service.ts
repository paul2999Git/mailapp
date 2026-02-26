import { GoogleGenerativeAI } from '@google/generative-ai';
import type { ClassificationInput, ClassificationResult } from '@mailhub/shared';

export class AIService {
    private genAI: GoogleGenerativeAI;
    private model: any;

    constructor() {
        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) {
            throw new Error('GEMINI_API_KEY not configured');
        }
        this.genAI = new GoogleGenerativeAI(apiKey);
    }

    /**
     * Classify an email message using Gemini AI
     */
    async classifyEmail(
        input: ClassificationInput,
        categories: { id: string; name: string; description?: string }[],
        customPrompt?: string,
        modelName?: string
    ): Promise<ClassificationResult> {
        const selectedModel = modelName || 'gemini-flash-latest';
        const model = this.genAI.getGenerativeModel({ model: selectedModel });
        const prompt = this.buildClassificationPrompt(input, categories, customPrompt);

        try {
            const result = await model.generateContent(prompt);
            const response = await result.response;
            const text = response.text();

            // Parse JSON from response
            const jsonMatch = text.match(/\{[\s\S]*\}/);
            if (!jsonMatch) {
                throw new Error('Failed to parse AI response as JSON');
            }

            const parsed = JSON.parse(jsonMatch[0]);

            return {
                categoryId: parsed.categoryId,
                confidence: parsed.confidence || 0.8,
                explanation: parsed.explanation || 'Classified by Gemini AI',
                factors: parsed.factors || [],
                suggestedAction: parsed.suggestedAction || 'inbox',
                needsHumanReview: parsed.confidence < 0.7,
            };
        } catch (error) {
            console.error('AI Classification failed:', error);
            throw error;
        }
    }

    private buildClassificationPrompt(
        input: ClassificationInput,
        categories: { id: string; name: string; description?: string }[],
        customPrompt?: string
    ): string {
        const categoryList = categories.map(c => `- ${c.name} (ID: ${c.id})${c.description ? `: ${c.description}` : ''}`).join('\n');

        const defaultPrompt = `
You are an expert email triage assistant. Your task is to classify an incoming email into exactly one of the provided categories.

AVAILABLE CATEGORIES:
{{categories}}

EMAIL DATA:
From: {{from}}
Subject: {{subject}}
Date: {{date}}
Body Preview: {{body}}
Attachment Types: {{attachments}}
Is Reply: {{isReply}}

ANALYSIS INSTRUCTIONS:
1. Carefully analyze the sender, subject, and body.
2. Consider the tone and purpose of the email.
3. Choose the most appropriate category ID from the list above.
4. If you are uncertain (confidence < 0.7), flag it for human review.

FINANCIAL EMAIL GUIDANCE (apply in order):
- If from a bank or credit card company AND the email is about an existing account (alert, statement, transaction, fraud notice, balance) → Banking - Critical
- If from a bank or credit card company AND the email is promotional, selling a product, or marketing → Banking - Marketing
- If the email is a bill, invoice, payment reminder, or says money is owed or due → Bills Due
- If the email is a purchase receipt, order confirmation, or shipping update → Receipts
- If the email is a newsletter or subscription digest that does not fit the above → Newsletters

RESPONSE FORMAT:
Respond exactly in this JSON format:
{
  "categoryId": "the-id-of-the-category",
  "confidence": 0.95,
  "explanation": "Brief explanation of why this category was chosen",
  "factors": ["list of key words or patterns identified"],
  "suggestedAction": "inbox"
}
`;

        const template = customPrompt || defaultPrompt;

        return template
            .replace('{{categories}}', categoryList)
            .replace('{{from}}', `${input.headers.from.name || ''} <${input.headers.from.email}>`)
            .replace('{{subject}}', input.headers.subject)
            .replace('{{date}}', input.headers.date.toString())
            .replace('{{body}}', input.bodyPreview || 'No content provided')
            .replace('{{attachments}}', input.attachmentTypes?.join(', ') || 'None')
            .replace('{{isReply}}', input.isReply.toString());
    }
}

export const aiService = new AIService();
