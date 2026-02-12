
import { GoogleGenerativeAI } from '@google/generative-ai';
import * as dotenv from 'dotenv';
import path from 'path';

// Load .env.dev from project root
dotenv.config({ path: path.join(__dirname, '../../.env.dev') });

const apiKey = process.env.GEMINI_API_KEY;

async function testGemini() {
    if (!apiKey) {
        console.error('GEMINI_API_KEY not found in .env.dev');
        return;
    }

    console.log('Testing Gemini API with key (prefix):', apiKey.substring(0, 8));

    const genAI = new GoogleGenerativeAI(apiKey);
    const modelName = 'gemini-flash-latest';
    console.log(`\nTesting full classification with model: ${modelName}...`);
    try {
        const model = genAI.getGenerativeModel({ model: modelName });
        const categories = [
            { id: '1', name: 'Personal', description: 'Personal emails' },
            { id: '2', name: 'Work', description: 'Work related' }
        ];
        const categoryList = categories.map(c => `- ${c.name} (ID: ${c.id}): ${c.description}`).join('\n');

        const prompt = `
        Classify this email into one of these categories:
        ${categoryList}

        Email:
        From: boss@work.com
        Subject: Meeting tomorrow
        Body: Please bring the report.

        Respond in JSON: {"categoryId": "id", "confidence": 0.9, "explanation": "..."}
        `;

        const result = await model.generateContent(prompt);
        const response = await result.response;
        console.log(`Success: ${response.text()}`);
    } catch (error: any) {
        console.error(`Failed: ${error.message}`);
    }
}

testGemini().catch(console.error);
