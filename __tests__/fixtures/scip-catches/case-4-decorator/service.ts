// Decorator usage references the imported symbol — SCIP resolves the
// reference even when the decorator name is the only call site of `Trace`.
import { Trace } from './decorators.js';

export class Service {
  @Trace()
  run(x: number): number {
    return x * 2;
  }
}
