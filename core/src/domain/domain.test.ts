import { describe, expect, it } from 'vitest';
import {
  brandTextColor,
  contrastRatio,
  formatLineNo,
  formatListLabel,
  initialsFromName,
  normalizeEmail,
  parseLineNo,
  parseListLabel,
  readableTextOn,
} from './index';
import { can } from '../permissions';

describe('list numbering', () => {
  it('formats job list labels with free-text job numbers', () => {
    expect(formatListLabel('2249', 1)).toBe('JOB#2249 LIST#1');
    expect(formatListLabel('26-BC249', 12)).toBe('JOB#26-BC249 LIST#12');
    expect(formatListLabel(' 2249 ', null)).toBe('JOB#2249 DRAFT');
  });

  it('parses list labels back', () => {
    expect(parseListLabel('JOB#26-BC249 LIST#3')).toEqual({ jobNumber: '26-BC249', listNo: 3 });
    expect(parseListLabel('job 2249 list 7')).toEqual({ jobNumber: '2249', listNo: 7 });
    expect(parseListLabel('2249-7')).toBeNull();
  });

  it('formats and parses line numbers', () => {
    expect(formatLineNo(1)).toBe('L1');
    expect(() => formatLineNo(0)).toThrow();
    expect(parseLineNo('L12')).toBe(12);
    expect(parseLineNo('3')).toBe(3);
    expect(parseLineNo('L0')).toBeNull();
    expect(parseLineNo('line')).toBeNull();
  });
});

describe('people', () => {
  it('normalizes emails', () => {
    expect(normalizeEmail('  Someone@Gmail.COM ')).toBe('someone@gmail.com');
  });
  it('derives initials', () => {
    expect(initialsFromName('Jane Smith')).toBe('JS');
    expect(initialsFromName('Jane van der Berg')).toBe('JB');
    expect(initialsFromName('Cher')).toBe('CH');
  });
});

describe('theme colours', () => {
  it('picks readable text on company colours', () => {
    expect(readableTextOn('#E8701A')).toBe('#000000'); // orange
    expect(readableTextOn('#2E7D32')).toBe('#ffffff'); // green
    expect(readableTextOn('#C62828')).toBe('#ffffff'); // red
  });
  it('darkens brand colours until they pass AA on white', () => {
    for (const c of ['#E8701A', '#2E7D32', '#C62828', '#FFD400']) {
      expect(contrastRatio(brandTextColor(c), '#ffffff')).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe('permissions', () => {
  const site = { roles: ['SITE'] as const, isPlatformOwner: false };
  const admin = { roles: ['ADMIN'] as const, isPlatformOwner: false };
  const owner = { roles: ['ADMIN'] as const, isPlatformOwner: true };
  it('enforces the role matrix', () => {
    expect(can(site, 'site:view')).toBe(true);
    expect(can(site, 'site:edit')).toBe(false);
    expect(can(admin, 'org:manage')).toBe(true);
    expect(can(admin, 'platform:manage')).toBe(false);
    expect(can(owner, 'platform:manage')).toBe(true);
    expect(can(null, 'site:view')).toBe(false);
  });
});
