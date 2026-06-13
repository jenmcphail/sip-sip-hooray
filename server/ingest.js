import OpenAI from 'openai';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { readFileSync } from 'fs';
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

const openai = new OpenAI({ apiKey: openaiApiKey });
const supabase = createClient(supabaseUrl, supabaseServiceKey);

const pairings = JSON.parse(
    readFileSync(join(__dirname, 'pairings_kb.json'), 'utf8')
);

async function embedAndInsert(pairing) {
    const textToEmbed = `
    Cuisine: ${pairing.cuisine_ethnicity}
    Protein: ${pairing.cuisine_protein}
    Flavor profile: ${pairing.cuisine_flavor_profile.join(', ')}
    Pairing principle: ${pairing.pairing_principle}
    Example drink: ${pairing.example_drink}
  `.trim();

    let embedding;
    try {
        const embeddingResponse = await openai.embeddings.create({
            model: 'text-embedding-3-small',
            input: textToEmbed,
        });
        embedding = embeddingResponse.data[0].embedding;
    } catch (err) {
        console.error(`OpenAI error for ${pairing.id}:`, err.message);
        return;
    }

    const { error } = await supabase.from('pairings').insert({
        ...pairing,
        embedding,
    });

    if (error) {
        console.error(`Supabase error for ${pairing.id}:`, error.message);
    } else {
        console.log(`Inserted ${pairing.id} — ${pairing.cuisine_ethnicity} ${pairing.cuisine_protein} (${pairing.level})`);
    }
}

async function ingest() {
    console.log(`Ingesting ${pairings.length} pairings...`);
    for (const pairing of pairings) {
        await embedAndInsert(pairing);
    }
    console.log('Done!');
}

ingest();
