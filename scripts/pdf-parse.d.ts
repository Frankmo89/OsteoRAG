declare module 'pdf-parse' {
  interface PdfPageData {
    getTextContent: (opts?: {
      normalizeWhitespace?: boolean;
    }) => Promise<{ items: Array<{ str: string }> }>;
    pageIndex?: number;
  }

  interface PdfData {
    numpages: number;
    text: string;
    info?: Record<string, unknown>;
  }

  function pdfParse(
    dataBuffer: Buffer,
    options?: {
      pagerender?: (pageData: PdfPageData) => Promise<string>;
      max?: number;
    },
  ): Promise<PdfData>;

  export = pdfParse;
}
