import type { NextConfig } from 'next';

// API-only server. Runs as a plain Node process (`next start`), so it can be
// hosted anywhere that runs Node or Docker (Render today, a Canadian host later).
const config: NextConfig = {
  output: 'standalone',
  transpilePackages: ['@supplyline/core'],
  serverExternalPackages: ['@react-pdf/renderer', 'sharp', 'tesseract.js', 'jsqr', 'qrcode', 'exceljs', '@anthropic-ai/sdk'],
  poweredByHeader: false,
};

export default config;


