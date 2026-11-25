// What the PDF worker runs before pdf.js (src/paper/pdf.ts, which reads this
// file as text). The page sends it the addresses of pdf.js's picture readers and
// the words of the warnings that say a part of a page is left out. It says
// whether the readers loaded, and that such a warning came, and never what one
// says.
self.addEventListener('message', function start({ data }) {
  const ask = data && data['oyh-start'];
  if (!ask) return;
  self.removeEventListener('message', start);
  console.warn = (warning) => {
    if (ask.leftOut.some((words) => String(warning).includes(words))) self.postMessage({ 'oyh-left-out': true });
  };
  Promise.all(ask.readers.map((address) => import(address))).then(
    () => self.postMessage({ 'oyh-readers': true }),
    () => self.postMessage({ 'oyh-readers': false }),
  );
});
