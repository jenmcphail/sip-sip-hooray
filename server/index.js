import express from 'express';
import cors from 'cors';
import OpenAI from 'openai';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '.env') });

const openaiApiKey = process.env.OPENAI_API_KEY;
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;

if (!openaiApiKey) {
    console.error('Missing OPENAI_API_KEY. Check server/.env exists and contains OPENAI_API_KEY=...');
    process.exit(1);
}
if (!supabaseUrl || !supabaseServiceKey) {
    console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY in server/.env');
    process.exit(1);
}

const app = express();
app.use(cors({
    origin: [
        'https://sip-sip-hooray.vercel.app',
        'http://localhost:5173'
    ]
}));
app.use(express.json());

const openai = new OpenAI({ apiKey: openaiApiKey });
const supabase = createClient(supabaseUrl, supabaseServiceKey);

function sendError(res, err, status = 500) {
    const message = err?.message ?? 'Unknown error';
    if (res.headersSent) {
        res.write(`data: ${JSON.stringify({ error: message })}\n\n`);
        res.end();
        return;
    }
    res.status(status).json({ error: message });
}

function formatPairingContext(pairings) {
    return (pairings ?? [])
        .map((p) => {
            const note = p.notes ? ` Note: ${p.notes}` : '';
            const type = p.alc ? 'alcoholic' : 'non-alcoholic';
            return `- ${p.level.toUpperCase()}: ${p.example_drink} (${type}) — ${p.pairing_principle}${note}`;
        })
        .join('\n');
}

app.post('/api/pair', async (req, res) => {
    const { meal, alcFilter } = req.body;

    if (!meal) {
        return res.status(400).json({ error: 'Meal description is required' });
    }

    try {
        const embeddingResponse = await openai.embeddings.create({
            model: 'text-embedding-3-small',
            input: meal,
        });
        const queryEmbedding = embeddingResponse.data[0].embedding;

        const { data: pairings, error } = await supabase.rpc('match_pairings', {
            query_embedding: queryEmbedding,
            match_threshold: 0.3,
            match_count: 9,
            filter_alc: alcFilter === 'alc' ? true : alcFilter === 'nonalc' ? false : null,
        });

        if (error) throw error;

        const pairingContext = formatPairingContext(pairings);

        const prompt = `You are a knowledgeable, opinionated drink pairing expert with a fun, approachable personality. You love both alcoholic and non-alcoholic drinks equally and get genuinely excited about interesting pairings.

The user is having: ${meal}

Based on your expertise, here are some relevant pairing principles to draw from:
${pairingContext}

Give the user 3 drink pairing recommendations — one casual, one mid-level, and one elevated. For each:
- Name the drink specifically (brand, style, or recipe)
- Explain briefly why it works with their meal (2-3 sentences max)
- Keep the tone fun, confident, and specific — not generic

Format your response exactly like this for each level:
🥤 CASUAL: [drink name]
[explanation]

🍶 MID: [drink name]
[explanation]

✨ ELEVATED: [drink name]
[explanation]

Be specific. "A cold lager" is less useful than "Modelo Especial." "Something acidic" is less useful than "GT's Trilogy kombucha." The specificity is the point.`;

        const stream = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            messages: [{ role: 'user', content: prompt }],
            stream: true,
            max_tokens: 600,
        });

        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');

        for await (const chunk of stream) {
            const content = chunk.choices[0]?.delta?.content || '';
            if (content) {
                res.write(`data: ${JSON.stringify({ content })}\n\n`);
            }
        }

        res.write('data: [DONE]\n\n');
        res.end();
    } catch (err) {
        console.error(err);
        sendError(res, err);
    }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
