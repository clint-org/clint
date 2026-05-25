declare module 'jaro-winkler' {
  function jaroWinkler(
    s1: string,
    s2: string,
    options?: { caseSensitive?: boolean },
  ): number;
  export default jaroWinkler;
}
