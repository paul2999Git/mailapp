
import { GoogleGenerativeAI } from '@google/generative-ai';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.dev' });

async function testModel(modelName: string) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
        console.error('No API key found');
        return;
    }

    console.log(`\n--- Testing Model: ${modelName} ---`);
    const genAI = new GoogleGenerativeAI(apiKey);

    try {
        const model = genAI.getGenerativeModel({ model: modelName });
        const result = await model.generateContent("Say 'hello test'");
        const response = await result.response;
        console.log(`✅ Success with ${modelName}:`, response.text());
    } catch (error: any) {
        console.error(`❌ Failed with ${modelName}:`, error.message);
    }
}

async function runTests() {
    await testModel('gemini-pro');
    await testModel('gemini-1.5-flash');
    await testModel('gemini-flash-latest');
}

runTests();
