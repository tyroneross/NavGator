export function Trace() {
  return function (_target: object, _key: string, desc: PropertyDescriptor) {
    const orig = desc.value;
    desc.value = function (...args: unknown[]) {
      return orig.apply(this, args);
    };
    return desc;
  };
}
