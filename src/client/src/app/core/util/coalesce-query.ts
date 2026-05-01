export function coalesceQuery(ms: number, fn: (q: string) => void): (q: string) => void {
  let handle: ReturnType<typeof setTimeout> | null = null;
  let last = '';
  return (q: string) => {
    last = q;
    if (handle) clearTimeout(handle);
    handle = setTimeout(() => { handle = null; fn(last); }, ms);
  };
}
