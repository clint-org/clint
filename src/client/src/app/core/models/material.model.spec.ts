import { describe, expect, it } from 'vitest';

import { classifyMaterialMime, materialExtLabel } from './material.model';

describe('materialExtLabel', () => {
  it('uses the real filename extension, uppercased', () => {
    expect(materialExtLabel('Lilly_orforglipron_briefing.pdf', 'pdf')).toBe('PDF');
    expect(materialExtLabel('ADA-2024_landscape.pptx', 'pptx')).toBe('PPTX');
  });

  it('keeps a short legacy extension that differs from the kind', () => {
    // a .doc file still classifies as the docx kind but should read "DOC"
    expect(materialExtLabel('memo.doc', 'docx')).toBe('DOC');
    expect(materialExtLabel('deck.ppt', 'pptx')).toBe('PPT');
  });

  it('falls back to the kind label when the name has no usable extension', () => {
    expect(materialExtLabel('no-extension', 'pdf')).toBe('PDF');
    expect(materialExtLabel('trailing-dot.', 'docx')).toBe('DOCX');
    expect(materialExtLabel('', 'other')).toBe('FILE');
  });

  it('ignores an over-long or non-alphanumeric extension and falls back to the kind', () => {
    expect(materialExtLabel('archive.backup2024', 'other')).toBe('FILE');
    expect(materialExtLabel('weird.p-d-f', 'pdf')).toBe('PDF');
  });

  it('returns FILE for an unclassified kind with no extension', () => {
    expect(materialExtLabel('data', classifyMaterialMime('application/octet-stream'))).toBe('FILE');
  });
});
