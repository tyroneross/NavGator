import { createRequire } from 'node:module';

interface PackageIdentity {
  name: string;
  version: string;
  license: string;
}

const require = createRequire(import.meta.url);
const packageIdentity = require('../package.json') as PackageIdentity;

/** Runtime identity sourced directly from the package manifest. */
export const NAVGATOR_PACKAGE_NAME = packageIdentity.name;
export const NAVGATOR_VERSION = packageIdentity.version;
export const NAVGATOR_LICENSE = packageIdentity.license;
