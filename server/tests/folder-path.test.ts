import { describe, expect, it } from 'vitest';
import { fileNameOf, isFullPath, joinIn } from '../src/lib/folder-path';

// The server may run on Linux while company folders are Windows paths (and the other way round).
describe('network folder paths', () => {
  it('accepts full Windows, network-share and Linux paths; rejects relative ones', () => {
    expect([isFullPath('P:\\AP\\Inbox'), isFullPath('\\\\server\\share\\AP'), isFullPath('/mnt/ap/inbox'), isFullPath('AP\\Inbox'), isFullPath('')]).toEqual([true, true, true, false, false]);
  });
  it('joins with the folder’s own separator', () => {
    expect(joinIn('P:\\Bowron\\', 'AAA\\Billing backup/A-1')).toBe('P:\\Bowron\\AAA\\Billing backup\\A-1');
    expect(joinIn('\\\\srv\\share', 'AP', 'x.pdf')).toBe('\\\\srv\\share\\AP\\x.pdf');
    expect(joinIn('/mnt/files', 'AAA\\Billing backup\\A-1')).toBe('/mnt/files/AAA/Billing backup/A-1');
    expect(fileNameOf('P:\\AP\\Inbox\\inv 1.pdf', '.pdf')).toBe('inv 1');
  });
});
