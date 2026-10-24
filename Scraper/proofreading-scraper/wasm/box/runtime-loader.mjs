// Production import guard. Build/stage-test processes do not install this hook.
function forbidden(value) {
  const name = String(value).replaceAll('\\', '/');
  return name.includes('/mapbuilder/base/') ||
    /(?:^|\/)bytenode(?:\/|$)/.test(name) || /\.jsc(?:$|[?#])/.test(name);
}

export async function resolve(specifier, context, nextResolve) {
  if (forbidden(specifier)) {
    throw new Error('WASM-only production: plain Engine map modules and JSC/bytenode are forbidden');
  }
  const resolved = await nextResolve(specifier, context);
  if (forbidden(resolved.url)) {
    throw new Error('WASM-only production: plain Engine map modules and JSC/bytenode are forbidden');
  }
  return resolved;
}
