import type { ClientInfo } from '../services/auth';
import { clientIp } from './http';

export function clientInfo(req: Request): ClientInfo {
  return {
    clientApp: req.headers.get('x-client-app'),
    clientVersion: req.headers.get('x-client-version'),
    userAgent: req.headers.get('user-agent'),
    ip: clientIp(req),
  };
}
