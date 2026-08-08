import express from 'express';
import OpenAI from 'openai';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import ws from 'ws';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '.env') });


function getConfig() {
    const openaiApiKey = process.env.OPENAI_API_KEY?.trim();
    const supabaseUrl = process.env.SUPABASE_URL?.trim();
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY?.trim();

    return {
        openaiApiKey,
        supabaseUrl,
        supabaseServiceKey,
        isConfigured: Boolean(openaiApiKey && supabaseUrl && supabaseServiceKey),
    };
}

function formatError(err) {
    const parts = [err?.message ?? String(err)];
    if (err?.cause?.code) parts.push(err.cause.code);
    if (err?.cause?.message && err.cause.message !== err?.message) {
        parts.push(err.cause.message);
    }
    return parts.filter(Boolean).join(' — ');
}

function getClients() {
    const config = getConfig();

    if (!config.isConfigured) {
        const missing = [
            !config.openaiApiKey && 'OPENAI_API_KEY',
            !config.supabaseUrl && 'SUPABASE_URL',
            !config.supabaseServiceKey && 'SUPABASE_SERVICE_KEY',
        ].filter(Boolean);

        throw new Error(`Server misconfigured. Missing: ${missing.join(', ')}`);
    }

    return {
        openai: new OpenAI({ apiKey: config.openaiApiKey }),
        supabase: createClient(config.supabaseUrl, config.supabaseServiceKey, {
            realtime: { transport: ws },
        }),
    };
}

const app = express();

app.get('/health', (_req, res) => {
    const config = getConfig();
    res.json({
        ok: true,
        configured: config.isConfigured,
    });
});

app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }
    next();
});

app.use(express.json());

function sendError(res, err, status = 500) {
    const message = formatError(err);
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

    let openai;
    let supabase;

    try {
        ({ openai, supabase } = getClients());
    } catch (err) {
        console.error(err.message);
        return res.status(503).json({ error: err.message });
    }

    try {
        let embeddingResponse;
        try {
            embeddingResponse = await openai.embeddings.create({
                model: 'text-embedding-3-small',
                input: meal,
            });
        } catch (err) {
            console.error('OpenAI embedding failed:', err);
            throw new Error(`OpenAI embedding failed: ${formatError(err)}`);
        }

        const queryEmbedding = embeddingResponse.data[0].embedding;

        let pairings;
        try {
            const { data, error } = await supabase.rpc('match_pairings', {
                query_embedding: queryEmbedding,
                match_threshold: 0.3,
                match_count: 9,
                filter_alc: alcFilter === 'alc' ? true : alcFilter === 'nonalc' ? false : null,
            });

            if (error) throw error;
            pairings = data;
        } catch (err) {
            console.error('Supabase search failed:', err);
            throw new Error(`Supabase search failed: ${formatError(err)}`);
        }

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

        let stream;
        try {
            stream = await openai.chat.completions.create({
                model: 'gpt-4o-mini',
                messages: [{ role: 'user', content: prompt }],
                stream: true,
                max_tokens: 600,
            });
        } catch (err) {
            console.error('OpenAI chat failed:', err);
            throw new Error(`OpenAI chat failed: ${formatError(err)}`);
        }

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

app.use((err, _req, res, _next) => {
    console.error(err);
    if (!res.headersSent) {
        res.status(500).json({ error: err.message ?? 'Internal server error' });
    }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, '0.0.0.0', () => {
    const config = getConfig();
    console.log(`Server running on port ${PORT}`);
    console.log(`Configured: ${config.isConfigured}`);
    if (!config.isConfigured) {
        console.error('Missing required env vars. Set OPENAI_API_KEY, SUPABASE_URL, and SUPABASE_SERVICE_KEY in Railway.');
    }
});
