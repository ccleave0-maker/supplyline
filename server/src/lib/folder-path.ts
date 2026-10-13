// Network folder paths. Company folders are usually Windows paths (P:\AP\Inbox,
// \\server\share\...) used by the Sync app on a PC, while the server itself may run
// on Linux. These helpers follow the style of the folder they're given, not the
// server's own operating system.
import path from 'node:path';

const isWindowsStyle = (p: string) => /^[A-Za-z]:[\\/]|^\\\\/.test(p);
const flavour = (p: string) => (isWindowsStyle(p) ? path.win32 : path.posix);

/** A full folder path on either kind of computer (P:\..., \\server\share\..., /mnt/...). */
export function isFullPath(p: string): boolean {
  return isWindowsStyle(p) || path.posix.isAbsolute(p);
}

/** Join inside a folder using that folder's own separator. */
export function joinIn(root: string, ...parts: string[]): string {
  return flavour(root).join(root, ...parts.flatMap((p) => p.split(/[\\/]+/)).filter(Boolean));
}

/** File name from a path written with either separator. */
export function fileNameOf(p: string, ext?: string): string {
  return path.win32.basename(p, ext);
}
