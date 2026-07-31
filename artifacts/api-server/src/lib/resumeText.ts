import mammoth from "mammoth";
import pdfParse from "pdf-parse/lib/pdf-parse.js";
import { fastLlmModel, llm, openRouterRouting, usingOpenRouter } from "./llm.js";
import { logger } from "./logger.js";

export interface UploadedResumeFile {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
}

export type ResumeTextSource = "pdf-text" | "pdf-ocr" | "docx" | "txt";

export interface ExtractedResumeText {
  text: string;
  source: ResumeTextSource;
}

export class ResumeTextExtractionError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "UNSUPPORTED_FILE"
      | "PASSWORD_PROTECTED"
      | "NO_TEXT"
      | "EXTRACTION_FAILED",
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "ResumeTextExtractionError";
  }
}

type PdfParser = (buffer: Buffer) => Promise<string>;
type DocxParser = (buffer: Buffer) => Promise<string>;
type PdfRecovery = (file: UploadedResumeFile) => Promise<string>;

interface ExtractionDependencies {
  parsePdf?: PdfParser;
  parseDocx?: DocxParser;
  recoverPdf?: PdfRecovery;
}

function extensionOf(filename: string) {
  return filename.split(".").pop()?.toLowerCase() ?? "";
}

export function hasUsableResumeText(value: string): boolean {
  const normalized = value.replace(/\s+/g, " ").trim();
  const words = normalized.match(/[\p{L}\p{N}][\p{L}\p{N}'’.-]*/gu) ?? [];
  return normalized.length >= 120 && words.length >= 20;
}

function hasReadableText(value: string): boolean {
  const normalized = value.replace(/\s+/g, " ").trim();
  const words = normalized.match(/[\p{L}\p{N}][\p{L}\p{N}'’.-]*/gu) ?? [];
  return normalized.length >= 20 && words.length >= 3;
}

function looksPasswordProtected(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /password|encrypted|encryption|no password/i.test(message);
}

async function parsePdfLocally(buffer: Buffer) {
  const result = await pdfParse(buffer);
  return result.text;
}

async function parseDocxLocally(buffer: Buffer) {
  const result = await mammoth.extractRawText({ buffer });
  return result.value;
}

async function recoverPdfWithOpenRouter(file: UploadedResumeFile): Promise<string> {
  if (!usingOpenRouter) {
    throw new Error("OpenRouter PDF recovery is not configured.");
  }

  const fileData = `data:application/pdf;base64,${file.buffer.toString("base64")}`;
  const pdfEngine = process.env.OPENROUTER_PDF_ENGINE?.trim() || "mistral-ocr";
  const completion = await llm.chat.completions.create({
    model: fastLlmModel,
    ...openRouterRouting(),
    max_completion_tokens: 12000,
    messages: [
      {
        role: "system",
        content:
          "Extract resume text faithfully. Preserve contact details, section headings, dates, employers, job titles, bullets, skills, education, and certifications. Return plain extracted text only. Do not summarize, rewrite, infer, or add commentary.",
      },
      {
        role: "user",
        content: [
          {
            type: "text",
            text: "Extract every readable word from this resume PDF. If no resume text can be read, return exactly __NO_TEXT__.",
          },
          {
            type: "file",
            file: {
              filename: file.originalname,
              file_data: fileData,
            },
          },
        ],
      },
    ],
    plugins: [
      {
        id: "file-parser",
        pdf: { engine: pdfEngine },
      },
    ],
  } as never);

  const recovered = completion.choices[0]?.message?.content?.trim() ?? "";
  return recovered === "__NO_TEXT__" ? "" : recovered;
}

export async function extractResumeText(
  file: UploadedResumeFile,
  dependencies: ExtractionDependencies = {},
): Promise<ExtractedResumeText> {
  const ext = extensionOf(file.originalname);
  const mime = file.mimetype.toLowerCase();

  if (mime === "text/plain" || ext === "txt") {
    const text = file.buffer.toString("utf-8");
    if (!hasReadableText(text)) {
      throw new ResumeTextExtractionError(
        "No readable resume text was found in this text file.",
        "NO_TEXT",
      );
    }
    return { text, source: "txt" };
  }

  if (
    mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    ext === "docx"
  ) {
    try {
      const text = await (dependencies.parseDocx ?? parseDocxLocally)(file.buffer);
      if (!hasReadableText(text)) {
        throw new ResumeTextExtractionError(
          "No readable resume text was found in this DOCX file. Try saving it again from Word, or upload a PDF.",
          "NO_TEXT",
        );
      }
      return { text, source: "docx" };
    } catch (error) {
      if (error instanceof ResumeTextExtractionError) throw error;
      throw new ResumeTextExtractionError(
        "We couldn't read this DOCX file. Try saving a fresh copy from Word, or upload a PDF or TXT version.",
        "EXTRACTION_FAILED",
        { cause: error },
      );
    }
  }

  if (mime !== "application/pdf" && ext !== "pdf") {
    throw new ResumeTextExtractionError(
      `Unsupported file type ".${ext || "unknown"}". Please upload a PDF, DOCX, or TXT file.`,
      "UNSUPPORTED_FILE",
    );
  }

  const parsePdf = dependencies.parsePdf ?? parsePdfLocally;
  const recoverPdf = dependencies.recoverPdf ?? recoverPdfWithOpenRouter;
  let localError: unknown;

  try {
    const text = await parsePdf(file.buffer);
    if (hasUsableResumeText(text)) {
      return { text, source: "pdf-text" };
    }
    localError = new Error("The PDF text layer was empty or unreadable.");
  } catch (error) {
    localError = error;
  }

  if (looksPasswordProtected(localError)) {
    throw new ResumeTextExtractionError(
      "This PDF is password-protected. Remove the password and upload it again, or upload a DOCX version.",
      "PASSWORD_PROTECTED",
      { cause: localError },
    );
  }

  logger.warn(
    {
      error: localError instanceof Error ? localError.message : String(localError),
      bytes: file.buffer.length,
    },
    "Local PDF extraction failed; trying OCR recovery",
  );

  try {
    const recovered = await recoverPdf(file);
    if (hasUsableResumeText(recovered)) {
      return { text: recovered, source: "pdf-ocr" };
    }
    throw new Error("OCR returned no usable resume text.");
  } catch (recoveryError) {
    logger.error(
      {
        localError: localError instanceof Error ? localError.message : String(localError),
        recoveryError: recoveryError instanceof Error ? recoveryError.message : String(recoveryError),
        bytes: file.buffer.length,
      },
      "PDF OCR recovery failed",
    );
    throw new ResumeTextExtractionError(
      "We couldn't read this PDF, even with OCR. If it opens normally, export it as a new PDF or upload the DOCX version.",
      "EXTRACTION_FAILED",
      { cause: recoveryError },
    );
  }
}
