import mammoth from 'mammoth';
import { PDFParse } from 'pdf-parse';

/**
 * Extract text from buffer (supports plain text, PDF, and DOCX)
 */
export async function extractText(buffer: Buffer, mimetype: string, filename: string): Promise<string> {
  try {
    // Plain text files
    if (mimetype.includes('text') || filename.endsWith('.txt')) {
      return buffer.toString('utf-8');
    }

    // PDF files
    if (mimetype.includes('pdf') || filename.endsWith('.pdf')) {
      const parser = new PDFParse({ data: buffer });
      try {
        const result = await parser.getText();
        return result.text;
      } catch (error) {
        console.error('Error parsing PDF:', error);
        throw new Error(`Failed to parse PDF: ${filename}`);
      } finally {
        await parser.destroy();
      }
    }

    // DOCX files
    if (
      mimetype.includes('wordprocessingml') ||
      mimetype.includes('word') ||
      filename.endsWith('.docx')
    ) {
      try {
        const result = await mammoth.extractRawText({ buffer });
        return result.value;
      } catch (error) {
        console.error('Error parsing DOCX:', error);
        throw new Error(`Failed to parse DOCX: ${filename}`);
      }
    }

    // Unsupported format - try UTF-8 as fallback
    console.warn(`Unsupported mimetype: ${mimetype}. Attempting UTF-8 extraction.`);
    return buffer.toString('utf-8');
  } catch (error) {
    console.error(`Error extracting text from ${filename}:`, error);
    throw error;
  }
}
