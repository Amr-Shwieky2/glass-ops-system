import "server-only";
import { z } from "zod";
import { generateText, AiProviderError } from "./provider";

export interface GenerateHebrewQuoteDraftInput {
  jobDescription: string;
  measurementDetails?: string;
  glassTypeLabel?: string;
}

export interface DraftQuoteItem {
  description: string;
  quantity: string;
  unit: string;
  unitPrice: string;
}

export interface DraftedQuote {
  items: DraftQuoteItem[];
  paymentTerms: string;
  workTerms: string;
}

/** User-facing error for every failure mode of AI drafting — network,
 * non-200, malformed JSON, or a response that doesn't match the expected
 * shape. Deliberately generic per AGENTS.md's instruction: never invent a
 * fallback quote, either it clearly worked or it clearly failed, and the
 * admin can always fall back to building the quote by hand. */
export class QuoteDraftGenerationError extends Error {
  constructor(cause?: unknown) {
    super("تعذر إنشاء المسودة، حاول تعديل الوصف أو إنشاء العرض يدوياً");
    this.name = "QuoteDraftGenerationError";
    if (cause !== undefined) this.cause = cause;
  }
}

const DraftQuoteItemSchema = z.object({
  description: z.string().trim().min(1),
  quantity: z.string().trim().min(1),
  unit: z.string().trim().min(1),
  unitPrice: z.string().trim().min(1),
});

const DraftedQuoteSchema = z.object({
  items: z.array(DraftQuoteItemSchema).min(1),
  paymentTerms: z.string().trim().min(1),
  workTerms: z.string().trim().min(1),
});

const SYSTEM_PROMPT = `אתה קבלן זכוכית ואלומיניום מקצועי בישראל, המנסח הצעות מחיר רשמיות בעברית עבור לקוחות.

המשימה שלך: לקרוא תיאור עבודה (ולעיתים גם פרטי מדידה בשטח וסוג זכוכית) ולהפיק מתוכו הצעת מחיר מפורטת לפי סעיפים (items), בתוספת תנאי תשלום ותנאי עבודה.

חשוב מאוד — פורמט התשובה:
- החזר אך ורק אובייקט JSON תקני יחיד, בעברית, ללא שום טקסט נוסף, ללא הסברים, ללא markdown, ללא גדרות קוד (בלי \`\`\`).
- מבנה ה-JSON חייב להיות בדיוק כך:

{
  "items": [
    { "description": "string - תיאור הסעיף בעברית", "quantity": "string - כמות מספרית, למשל \\"2.5\\"", "unit": "string - יחידת מידה בעברית, למשל מ\\"ר, יחידה, מטר רץ", "unitPrice": "string - מחיר ליחידה, מספר בלבד ללא סימן מטבע, למשל \\"350.00\\"" }
  ],
  "paymentTerms": "string - תנאי תשלום בעברית, למשל מקדמה ויתרה עם סיום העבודה",
  "workTerms": "string - תנאי עבודה בעברית, למשל אחריות, לוחות זמנים, אחריות לתיאום גישה"
}

- כלול לפחות סעיף אחד ב-items.
- כל המחירים והכמויות הם מחרוזות טקסט (string) המייצגות מספרים, לא מספרים ממש.
- אל תוסיף שדות נוספים מעבר לאלה שהוגדרו.
- אל תוסיף סימני מטבע (₪ וכו') בתוך unitPrice — מספר בלבד.
- חשוב: אל תשתמש בגרשיים (") בתוך אף אחד מהערכים, גם לא בקיצורים כמו ש"מ — כתוב תמיד את המילה המלאה (למשל "מטר רבוע" ולא "ש"מ", "מטר" ולא "מ'"). גרשיים בתוך ערך יפגעו בתקינות ה-JSON.`;

function buildUserPrompt(input: GenerateHebrewQuoteDraftInput): string {
  const lines = [`תיאור העבודה שנמסר על ידי הצוות: ${input.jobDescription}`];
  if (input.glassTypeLabel) {
    lines.push(`סוג הזכוכית שנרשם: ${input.glassTypeLabel}`);
  }
  if (input.measurementDetails) {
    lines.push(`פרטי מדידה שנרשמו בשטח: ${input.measurementDetails}`);
  }
  lines.push("הפק כעת את אובייקט ה-JSON של הצעת המחיר, בעברית, לפי המבנה שהוגדר.");
  return lines.join("\n");
}

/** Strips a ```json ... ``` or ``` ... ``` fence wrapping the whole
 * response, if present — the one cheap recovery attempted before giving
 * up, since smaller local models frequently ignore "no markdown fences"
 * instructions. */
function stripCodeFences(raw: string): string {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenced ? fenced[1].trim() : trimmed;
}

function tryParseDraftedQuote(raw: string): DraftedQuote | null {
  try {
    const parsed = DraftedQuoteSchema.parse(JSON.parse(raw));
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Repairs the single most common way qwen2.5:3b breaks its own JSON despite
 * the system prompt explicitly forbidding it: emitting a literal, unescaped
 * `"` inside a string value — almost always a Hebrew ש"מ/ח"פ-style
 * abbreviation (e.g. `"unit": "ש"מ"`). A direct JSON.parse of that fails
 * immediately, so before giving up this walks the raw text tracking
 * whether it is inside a JSON string, and for every `"` encountered while
 * inside one, escapes it UNLESS it is genuinely the string's closing
 * quote — decided by looking past any following whitespace for the next
 * structurally-significant character (`,` `:` `}` `]`, or end of input),
 * which is exactly what a real closing quote is always followed by.
 * Already-escaped quotes (`\"`) are left untouched. This only ever adds
 * backslashes inside string content; it cannot alter numbers, structural
 * punctuation, or keys, so it cannot turn a validly-parsing document into
 * something that means something different — it can only turn a
 * currently-unparseable document into a parseable one.
 */
function repairInlineQuotes(raw: string): string {
  let result = "";
  let inString = false;
  let escaped = false;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (!inString) {
      result += ch;
      if (ch === '"') inString = true;
      continue;
    }
    if (escaped) {
      result += ch;
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      result += ch;
      escaped = true;
      continue;
    }
    if (ch === '"') {
      let j = i + 1;
      while (j < raw.length && /\s/.test(raw[j])) j++;
      const next = j < raw.length ? raw[j] : undefined;
      const isRealClose = next === undefined || next === "," || next === ":" || next === "}" || next === "]";
      if (isRealClose) {
        result += ch;
        inString = false;
      } else {
        result += '\\"';
      }
      continue;
    }
    result += ch;
  }
  return result;
}

/**
 * Generates an itemized quote draft in Hebrew from a free-text job
 * description (and whatever measurement context is available for the
 * job). Draft-assist only (see AGENTS.md / src/server/quotes/ai-draft-
 * actions.ts) — this function never touches the database; its result only
 * pre-fills the existing Quote Builder dialog for a human to review and
 * explicitly save.
 */
export async function generateHebrewQuoteDraft(
  input: GenerateHebrewQuoteDraftInput,
): Promise<DraftedQuote> {
  let rawResponse: string;
  try {
    rawResponse = await generateText({
      systemPrompt: SYSTEM_PROMPT,
      userPrompt: buildUserPrompt(input),
      jsonMode: true,
    });
  } catch (err) {
    if (err instanceof AiProviderError) {
      throw new QuoteDraftGenerationError(err);
    }
    throw new QuoteDraftGenerationError(err);
  }

  const direct = tryParseDraftedQuote(rawResponse);
  if (direct) return direct;

  // Recovery attempts, cheapest/most-targeted first: smaller local models
  // sometimes wrap the JSON in a markdown code fence despite being told
  // not to, and/or emit a stray literal quote inside a string value
  // (Hebrew ש"מ-style abbreviations) despite the same instruction. Try
  // each individually, then both combined, since either can occur alone
  // or together.
  const unfenced = stripCodeFences(rawResponse);
  const recovered = tryParseDraftedQuote(unfenced);
  if (recovered) return recovered;

  const requoted = tryParseDraftedQuote(repairInlineQuotes(rawResponse));
  if (requoted) return requoted;

  const bothRepaired = tryParseDraftedQuote(repairInlineQuotes(unfenced));
  if (bothRepaired) return bothRepaired;

  throw new QuoteDraftGenerationError(
    new Error(`Model response did not match expected schema: ${rawResponse.slice(0, 500)}`),
  );
}
