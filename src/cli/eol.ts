/**
 * Line-ending normalization for files the CLI writes.
 */

/** Line ending style for generated files. */
export type EolStyle = 'lf' | 'crlf';

/**
 * Convert content to the requested line ending style.
 *
 * @param content - Text using LF and/or CRLF line endings
 * @param eol - Target style (defaults to `'lf'`)
 * @returns The text with every line ending converted
 */
export const applyEol = (content: string, eol: EolStyle = 'lf'): string =>
  eol === 'crlf' ? content.replace(/\r?\n/g, '\r\n') : content.replace(/\r\n/g, '\n');
