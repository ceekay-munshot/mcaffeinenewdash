// Claude-via-AWS-Bedrock path for supplier financial extraction — a drop-in
// alternative to the OpenAI call in llm_financials.mjs, selected only when
// LLM_PROVIDER=claude. Mirrors callLLM()'s contract exactly: given the same
// (folder, text, prompt) inputs, resolves to the same parsed-JSON profile
// shape (or null after 3 failed attempts), so shape() downstream doesn't
// need to know which provider produced it.
//
// To remove the Claude path entirely: delete this file and the LLM_PROVIDER
// branch in llm_financials.mjs. The OpenAI path is untouched either way.
//
//   LLM_PROVIDER=claude CLAUDE_BEDROCK_API_KEY=... node scripts/pdf/llm_financials.mjs
//
// Region/model default to us-east-1 / us.anthropic.claude-sonnet-4-5-20250929-v1:0
// (ASSUMPTION — verify against the AWS account actually used; override via
// BEDROCK_REGION / BEDROCK_MODEL_ID if it already standardizes on something else).

const REGION = process.env.BEDROCK_REGION || "us-east-1";
const MODEL_ID = process.env.BEDROCK_MODEL_ID || "us.anthropic.claude-sonnet-4-5-20250929-v1:0";
const KEY = process.env.CLAUDE_BEDROCK_API_KEY;

const SYSTEM_PROMPT =
  "You extract accurate structured data from messy Tracxn report text. Output only valid JSON. Never invent numbers.";

// Claude sometimes wraps JSON in prose or code fences despite instructions —
// pull out the outermost {...} object rather than assuming res is bare JSON.
function extractJsonObject(text) {
  const match = text.match(/\{[\s\S]*\}/);
  return match ? match[0] : text;
}

export async function callBedrockFinancials(folder, text, prompt) {
  if (!KEY) throw new Error("CLAUDE_BEDROCK_API_KEY not set");
  const body = {
    system: [{ text: SYSTEM_PROMPT }],
    messages: [
      {
        role: "user",
        content: [{ text: `${prompt}\n\nCompany folder: ${folder}\n\nREPORT TEXT:\n${text.slice(0, 84000)}` }],
      },
    ],
    inferenceConfig: { temperature: 0 },
  };
  const url = `https://bedrock-runtime.${REGION}.amazonaws.com/model/${encodeURIComponent(MODEL_ID)}/converse`;
  for (let a = 0; a < 3; a++) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { authorization: `Bearer ${KEY}`, "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 140)}`);
      const j = await res.json();
      const raw = j.output?.message?.content?.[0]?.text ?? "";
      return JSON.parse(extractJsonObject(raw));
    } catch (e) {
      if (a === 2) { console.log(`  ! ${folder} (claude): ${String(e).slice(0, 110)}`); return null; }
      await new Promise((r) => setTimeout(r, 1500 * (a + 1)));
    }
  }
}
