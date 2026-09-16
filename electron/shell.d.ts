// Shell scripts are bundled as text. Keeping them in real .sh/.zsh files
// rather than template literals means one level of escaping instead of three —
// the embedded version silently lost its \e and \a and shipped a shell
// integration that emitted nothing.
declare module '*.sh' {
  const contents: string;
  export default contents;
}
declare module '*.zsh' {
  const contents: string;
  export default contents;
}
