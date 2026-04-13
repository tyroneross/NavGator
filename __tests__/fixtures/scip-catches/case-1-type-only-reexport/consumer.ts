import type { User } from './barrel.js';

export function welcome(u: User): string {
  return `hello ${u.email}`;
}
