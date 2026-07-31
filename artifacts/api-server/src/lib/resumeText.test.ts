import assert from "node:assert/strict";
import test from "node:test";
import {
  extractResumeText,
  hasUsableResumeText,
  ResumeTextExtractionError,
  type UploadedResumeFile,
} from "./resumeText.js";

const resumeText = `
Jordan Taylor
jordan@example.com | Chicago, IL

SUMMARY
Data engineer with six years of experience building reliable analytics systems.

EXPERIENCE
Senior Data Engineer, Example Company, 2020–Present
- Built Python and SQL data pipelines that reduced reporting time by 40 percent.
- Partnered with product and finance teams to improve data quality and documentation.

SKILLS
Python, SQL, Snowflake, Docker, AWS, Tableau
`;

function pdfFile(): UploadedResumeFile {
  return {
    buffer: Buffer.from("%PDF simulated test file"),
    originalname: "resume.pdf",
    mimetype: "application/pdf",
  };
}

test("recognizes useful resume text", () => {
  assert.equal(hasUsableResumeText(resumeText), true);
  assert.equal(hasUsableResumeText("short document"), false);
});

test("uses the local PDF text layer when it is readable", async () => {
  let recoveryCalls = 0;
  const result = await extractResumeText(pdfFile(), {
    parsePdf: async () => resumeText,
    recoverPdf: async () => {
      recoveryCalls += 1;
      return resumeText;
    },
  });

  assert.equal(result.source, "pdf-text");
  assert.equal(result.text, resumeText);
  assert.equal(recoveryCalls, 0);
});

test("falls back to OCR when the PDF parser throws", async () => {
  const result = await extractResumeText(pdfFile(), {
    parsePdf: async () => {
      throw new Error("bad XRef entry");
    },
    recoverPdf: async () => resumeText,
  });

  assert.equal(result.source, "pdf-ocr");
  assert.equal(result.text, resumeText);
});

test("falls back to OCR for an image-only PDF", async () => {
  const result = await extractResumeText(pdfFile(), {
    parsePdf: async () => "",
    recoverPdf: async () => resumeText,
  });

  assert.equal(result.source, "pdf-ocr");
});

test("gives a specific message for password-protected PDFs", async () => {
  let recoveryCalls = 0;
  await assert.rejects(
    extractResumeText(pdfFile(), {
      parsePdf: async () => {
        throw new Error("PasswordException: No password given");
      },
      recoverPdf: async () => {
        recoveryCalls += 1;
        return resumeText;
      },
    }),
    (error: unknown) => {
      assert.ok(error instanceof ResumeTextExtractionError);
      assert.equal(error.code, "PASSWORD_PROTECTED");
      assert.match(error.message, /password-protected/i);
      return true;
    },
  );
  assert.equal(recoveryCalls, 0);
});

test("returns an actionable error when both PDF paths fail", async () => {
  await assert.rejects(
    extractResumeText(pdfFile(), {
      parsePdf: async () => {
        throw new Error("bad XRef entry");
      },
      recoverPdf: async () => "",
    }),
    (error: unknown) => {
      assert.ok(error instanceof ResumeTextExtractionError);
      assert.equal(error.code, "EXTRACTION_FAILED");
      assert.match(error.message, /even with OCR/i);
      return true;
    },
  );
});

test("extracts useful TXT resumes and rejects unsupported files", async () => {
  const txt = await extractResumeText({
    buffer: Buffer.from(resumeText),
    originalname: "resume.txt",
    mimetype: "text/plain",
  });
  assert.equal(txt.source, "txt");

  await assert.rejects(
    extractResumeText({
      buffer: Buffer.from("legacy"),
      originalname: "resume.doc",
      mimetype: "application/msword",
    }),
    (error: unknown) => {
      assert.ok(error instanceof ResumeTextExtractionError);
      assert.equal(error.code, "UNSUPPORTED_FILE");
      return true;
    },
  );
});

test("extracts DOCX text and reports damaged DOCX files accurately", async () => {
  const file: UploadedResumeFile = {
    buffer: Buffer.from("simulated docx"),
    originalname: "resume.docx",
    mimetype: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  };
  const parsed = await extractResumeText(file, { parseDocx: async () => resumeText });
  assert.equal(parsed.source, "docx");

  await assert.rejects(
    extractResumeText(file, {
      parseDocx: async () => {
        throw new Error("invalid central directory");
      },
    }),
    (error: unknown) => {
      assert.ok(error instanceof ResumeTextExtractionError);
      assert.equal(error.code, "EXTRACTION_FAILED");
      assert.match(error.message, /fresh copy from Word/i);
      return true;
    },
  );
});
