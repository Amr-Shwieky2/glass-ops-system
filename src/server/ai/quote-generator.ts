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
    });
  } catch (err) {
    if (err instanceof AiProviderError) {
      throw new QuoteDraftGenerationError(err);
    }
    throw new QuoteDraftGenerationError(err);
  }

  const direct = tryParseDraftedQuote(rawResponse);
  if (direct) return direct;

  // One cheap recovery attempt: smaller local models sometimes wrap the
  // JSON in a markdown code fence despite being told not to.
  const recovered = tryParseDraftedQuote(stripCodeFences(rawResponse));
  if (recovered) return recovered;

  throw new QuoteDraftGenerationError(
    new Error(`Model response did not match expected schema: ${rawResponse.slice(0, 500)}`),
  );
}
